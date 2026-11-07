import { Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import messages from 'src/application/services/agent/localFiles/messages.json';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import { format, numbered, textParam, ToolContext, ToolGenerator, ToolParam } from 'src/application/services/agent/tools/toolKit';
import { DriverKind } from '../notification/cargoTripType';
import { DriverCard, DriverProfileService } from './driverProfile.service';

// one answer: the first of them, the rest on the «رانندگان» page
const PAGE_SIZE = 20;
// a company, not a driver (toolKit's COMPANY_ROLES lets a driver through for the cargo tools)
const COMPANY_ONLY = ['COMPANY', 'COMPANY_ADMIN'];

const KINDS: Record<string, DriverKind> = { DOMESTIC: 'DOMESTIC', INTERNATIONAL: 'INTERNATIONAL' };

/**
 * ابزار agent برای «رانندگان» شرکت حمل‌ونقل (domain company_drivers): همان لیست صفحه‌ی «رانندگان» پنل
 * (DriverProfileService.listByKinds؛ قفل امکان DRIVERS: COMPANY_FEATURE_BY_AGENT_TOOL)، داخلی، بین‌المللی یا هر دو، با جستجو در نام، موبایل یا پلاک.
 */
@Injectable()
export class CompanyDriverTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly profiles: DriverProfileService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'list_company_drivers',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'list_company_drivers', param);
        if (!(param.req.user.roles ?? []).some((role) => COMPANY_ONLY.includes(role))) ctx.fail(messages.companyDrivers.notCompany);

        const kind = KINDS[textParam(param.driverKind)?.toUpperCase() ?? ''];
        const search = textParam(param.search);
        const page = await self.profiles.listByKinds(kind ? [kind] : ['DOMESTIC', 'INTERNATIONAL'], 1, PAGE_SIZE, search, ctx.userId);
        const kindText = kind ? ` ${kind === 'DOMESTIC' ? messages.companyDrivers.domestic : messages.companyDrivers.international}` : '';
        if (page.items.length === 0) {
          const empty = search
            ? format(messages.companyDrivers.noneMatching, { kind: kindText, search })
            : format(messages.companyDrivers.none, { kind: kindText });
          return ctx.done({ count: '0' }, empty);
        }

        const header = format(messages.companyDrivers.header, {
          count: page.total,
          kind: kindText,
          search: search ? ` «${search}»` : '',
          scope: page.total > page.items.length ? format(messages.companyDrivers.shown, { shown: page.items.length }) : '',
        });
        return ctx.done({ count: String(page.total) }, `${header}\n${numbered(page.items.map((driver) => self.line(driver)))}`);
      },
    });
  }

  /** «رضا احمدی — تریلی کفی · ۱۲ع۳۴۵ ایران ۶۷ · ۲۵ تن · تبریز · ۰۹۱۲…» */
  private line(driver: DriverCard): string {
    const vehicle = [driver.vehicleType, driver.vehicleModel].filter(Boolean).join(' ');
    const details = [
      vehicle,
      driver.plate,
      driver.capacityTons ? format('{tons} تن', { tons: driver.capacityTons }) : null,
      driver.homeCity,
      driver.mobile,
      driver.verified ? null : messages.companyDrivers.unverified,
    ].filter(Boolean);
    return details.length ? `${driver.name} — ${details.join(' · ')}` : driver.name;
  }
}
