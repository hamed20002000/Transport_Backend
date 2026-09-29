import { Injectable, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ContextManager } from 'src/application/services/agent/contextManager';
import messages from 'src/application/services/agent/localFiles/messages.json';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import {
  COMPANY_ROLES,
  format,
  textParam,
  ToolContext,
  ToolGenerator,
  ToolParam,
} from 'src/application/services/agent/tools/toolKit';
import { CustomerType } from 'src/domain/enums/company.enum';
import { UpdateUserProfileDto } from 'src/dto/user/update-user-profile.dto';
import { UserService } from './UserService';

// ترتیب و عنوان فیلدها همان صفحه‌ی پروفایل در وب
const FIELD_LABELS: Record<string, string> = {
  profileType: 'نوع حساب',
  firstName: 'نام',
  lastName: 'نام خانوادگی',
  nationalCode: 'کد ملی',
  companyName: 'نام شرکت',
  companyNationalId: 'شناسه ملی شرکت',
  economicCode: 'کد اقتصادی',
  registrationNo: 'شماره ثبت',
  phone: 'تلفن ثابت',
  postalCode: 'کد پستی',
  address: 'نشانی',
  mobile: 'موبایل',
  email: 'ایمیل',
};
const EDITABLE = Object.keys(FIELD_LABELS).filter((key) => key !== 'mobile' && key !== 'email');

const PROFILE_TYPES: Record<string, CustomerType> = { PERSON: CustomerType.Person, COMPANY: CustomerType.Company };

/**
 * ابزارهای agent برای پروفایل (domain company_profile)، روی همان
 * UserService.getProfile / updateProfile که صفحه‌ی پروفایل استفاده می‌کند.
 */
@Injectable()
export class CompanyProfileTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly users: UserService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند (الگوی setash)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'get_company_profile',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'get_company_profile', param);
        ctx.requireRole(COMPANY_ROLES);

        const profile = await self.users.getProfile(ctx.userId);
        const lines = self.lines(profile as unknown as Record<string, unknown>, Object.keys(FIELD_LABELS));
        return ctx.done({}, lines.length ? `${messages.profile.header}\n${lines.join('\n')}` : messages.profile.empty);
      },
    });

    this.toolRegister.register({
      functionName: 'update_company_profile',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'update_company_profile', param);
        ctx.requireRole(COMPANY_ROLES);

        //#region -------- What the user asked to change -----------------
        const changes: Record<string, unknown> = {};
        for (const key of EDITABLE) {
          const value = textParam(param[key]);
          if (value === undefined) continue;
          if (key === 'profileType') {
            if (value in PROFILE_TYPES) changes.profileType = PROFILE_TYPES[value];
          } else {
            changes[key] = value;
          }
        }
        if (Object.keys(changes).length === 0) ctx.fail(messages.profile.nothingToChange);
        //#endregion

        //#region -------- Same validation as the profile page ------------
        const dto = plainToInstance(UpdateUserProfileDto, changes);
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
        // مدل گاهی یکی از چند مقدارِ یک جمله را جا می‌اندازد؛ کاربر قبل از ثبت می‌بیند چه چیزی ذخیره می‌شود.
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

        const saved = await self.users.updateProfile(ctx.userId, dto);
        const savedLines = self.lines(saved as unknown as Record<string, unknown>, Object.keys(changes)).join('\n');
        return ctx.done(
          { saved: 'true', fields: Object.keys(changes).join(',') },
          format(messages.profile.saved, { summary: savedLines }),
        );
      },
    });
  }

  private lines(values: Record<string, unknown>, keys: string[]): string[] {
    return keys
      .filter((key) => values[key] !== undefined && values[key] !== null && values[key] !== '')
      .map(
        (key) =>
          `${FIELD_LABELS[key]}: ${key === 'profileType' ? this.profileTypeTitle(values[key]) : String(values[key])}`,
      );
  }

  private profileTypeTitle(value: unknown): string {
    return value === CustomerType.Company ? 'حقوقی' : 'حقیقی';
  }
}
