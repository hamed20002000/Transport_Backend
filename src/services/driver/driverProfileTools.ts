import { Injectable, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ContextManager } from 'src/application/services/agent/contextManager';
import messages from 'src/application/services/agent/localFiles/messages.json';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import {
  DRIVER_ROLES,
  format,
  textParam,
  ToolContext,
  ToolGenerator,
  ToolParam,
} from 'src/application/services/agent/tools/toolKit';
import { UpdateDriverProfileDto } from 'src/dto/notification/DriverProfileDto';
import { DriverProfileService } from './driverProfile.service';

// ترتیب و عنوان فیلدها همان صفحه‌ی پروفایل راننده در وب
const FIELD_LABELS: Record<string, string> = {
  firstName: 'نام',
  lastName: 'نام خانوادگی',
  nationalCode: 'کد ملی',
  smartCardNumber: 'شماره کارت هوشمند',
  licenseNumber: 'شماره گواهینامه',
  fleetCardNumber: 'شماره کارت ناوگان',
  homeCity: 'شهر محل سکونت',
  vehicleType: 'نوع خودرو',
  vehicleModel: 'مدل خودرو',
  plate: 'پلاک',
  capacityTons: 'ظرفیت (تن)',
  mobile: 'موبایل',
};
const EDITABLE = Object.keys(FIELD_LABELS).filter((key) => key !== 'mobile');

const toLatinDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * ابزارهای agent برای پروفایل راننده (domain driver_profile)، روی همان DriverProfileService
 * که صفحه‌ی پروفایل راننده استفاده می‌کند؛ ویرایش مثل پروفایل شرکت قبل از ثبت تأیید می‌گیرد.
 */
@Injectable()
export class DriverProfileTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly profiles: DriverProfileService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند (الگوی setash)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'get_driver_profile',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'get_driver_profile', param);
        self.requireDriver(ctx, param);

        const profile = await self.profiles.get(ctx.userId);
        const lines = self.lines(profile as unknown as Record<string, unknown>, Object.keys(FIELD_LABELS));
        return ctx.done({}, lines.length ? `${messages.profile.header}\n${lines.join('\n')}` : messages.profile.empty);
      },
    });

    this.toolRegister.register({
      functionName: 'update_driver_profile',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'update_driver_profile', param);
        self.requireDriver(ctx, param);

        //#region -------- What the user asked to change -----------------
        const changes: Record<string, unknown> = {};
        for (const key of EDITABLE) {
          const value = textParam(param[key]);
          if (value === undefined) continue;
          // ظرفیت عدد است (DTO رقم فارسی و «تن» را نمی‌فهمد): «۲۴ تن» → «24»
          changes[key] = key === 'capacityTons' ? (toLatinDigits(value).match(/\d+(\.\d+)?/)?.[0] ?? value) : value;
        }
        if (Object.keys(changes).length === 0) ctx.fail(messages.profile.nothingToChange);
        //#endregion

        //#region -------- Same validation as the profile page ------------
        const dto = plainToInstance(UpdateDriverProfileDto, changes);
        const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length) {
          ctx.fail(
            format(messages.profile.invalid, {
              fields: errors.map((e) => FIELD_LABELS[e.property] ?? e.property).join('، '),
            }),
          );
        }
        //#endregion

        //#region -------- Confirm before writing --------------------------
        const summary = self.lines(dto as unknown as Record<string, unknown>, EDITABLE).join('\n');
        const answer = yield {
          type: 'selection',
          label: format(messages.profile.confirm, { summary }),
          data: [
            { id: 'yes', title: messages.profile.confirmYes },
            { id: 'no', title: messages.profile.confirmNo },
          ],
        };
        if (answer !== 'yes') return ctx.done({ saved: 'false' }, messages.profile.notSaved);
        //#endregion

        const saved = await self.profiles.update(ctx.userId, dto);
        const savedLines = self.lines(saved as unknown as Record<string, unknown>, Object.keys(changes)).join('\n');
        return ctx.done(
          { saved: 'true', fields: Object.keys(changes).join(',') },
          format(messages.profile.saved, { summary: savedLines }),
        );
      },
    });
  }

  private requireDriver(ctx: ToolContext, param: ToolParam): void {
    if (!(param.req.user.roles ?? []).some((role) => DRIVER_ROLES.includes(role))) ctx.fail(messages.driverLoads.notAllowed);
  }

  private lines(values: Record<string, unknown>, keys: string[]): string[] {
    return keys
      .filter((key) => values[key] !== undefined && values[key] !== null && values[key] !== '')
      .map((key) => `${FIELD_LABELS[key]}: ${String(values[key])}`);
  }
}
