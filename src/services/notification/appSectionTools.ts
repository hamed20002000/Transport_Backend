import { Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import { COMPANY_ROLES, textParam, ToolContext, ToolGenerator, ToolParam } from 'src/application/services/agent/tools/toolKit';
import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { TripAction } from 'src/domain/constants/bot/TripAction';
import { MarketAction } from '../market/marketBot.service';

const DRIVER = ['DRIVER'];
const DRIVER_AND_COMPANY = ['DRIVER', ...COMPANY_ROLES];

interface AppSection {
  roles: string[];
  /** the bot page (opened in the messengers through RequestResult.menuAction) */
  menuAction: string;
  /** the answer where there is no bot page (web chat): what it is and where to find it */
  message: string;
}

/**
 * Pages of the app that have no tool of their own: the user asks for them in their own words («نزدیک‌ترین
 * پمپ بنزین کجاست؟»، «قیمت دلار چنده؟») and the messengers open that page, as if its button was pressed.
 * Keys are the `section` values in tools.json (open_app_section).
 */
export const APP_SECTIONS: Record<string, AppSection> = {
  near_fuel_stations: {
    roles: DRIVER,
    menuAction: TripAction.NearStations,
    message: 'جایگاه‌های سوخت نزدیک شما در ربات پیام‌رسان (موقعیت من ← جایگاه‌های نزدیک) نشان داده می‌شود؛ در وب، جایگاه‌های سر راه هر بار در جزئیات همان بار است.',
  },
  my_location: {
    roles: DRIVER,
    menuAction: TripAction.MyLocation,
    message: 'آخرین موقعیت شما در ربات پیام‌رسان («موقعیت من») و در پنل وب (خانه ← ارسال موقعیت) است.',
  },
  active_trip: {
    roles: DRIVER,
    menuAction: TripAction.ActiveTrip,
    message: 'سفر فعال شما در پنل وب، تب «سفر فعال» است.',
  },
  return_loads: {
    roles: DRIVER,
    menuAction: TripAction.ReturnLoads,
    message: 'بارهای برگشتی از مقصد سفرتان در ربات پیام‌رسان («بار برگشتی») و در جزئیات هر بار در وب است.',
  },
  my_requests: {
    roles: DRIVER,
    menuAction: `${TripAction.DriverRequests}1`,
    message: 'درخواست‌های بار شما در پنل وب، تب «درخواست‌ها» است.',
  },
  company_active_trips: {
    roles: COMPANY_ROLES,
    menuAction: `${TripAction.CompanyTrips}1`,
    message: 'سفرهای فعال رانندگان شما در پنل وب، تب «سفرها» است.',
  },
  company_driver_requests: {
    roles: COMPANY_ROLES,
    menuAction: `${TripAction.CompanyRequests}1`,
    message: 'درخواست‌های رانندگان برای بارهایتان در ربات پیام‌رسان («درخواست رانندگان») است.',
  },
  market_prices: {
    roles: DRIVER_AND_COMPANY,
    menuAction: MarketAction.Show,
    message: 'قیمت دلار، یورو و طلا در نوار بالای پنل وب و در ربات پیام‌رسان («قیمت دلار و طلا») است.',
  },
  main_menu: {
    roles: DRIVER_AND_COMPANY,
    menuAction: BotCallback.MainMenu,
    message: 'منوی اصلی در ربات پیام‌رسان است؛ در وب، از منوی بالای صفحه.',
  },
};

/** ابزار agent برای باز کردن صفحه‌های برنامه که ابزار جدا ندارند (domain app_sections). */
@Injectable()
export class AppSectionTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند (الگوی setash)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'open_app_section',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'open_app_section', param);
        const name = textParam(param.section) ?? '';
        const section = APP_SECTIONS[name];
        if (!section) ctx.fail('این بخش در برنامه نیست؛ از منوی اصلی بخش موردنظر را انتخاب کنید.');
        ctx.requireRole(section.roles);
        return ctx.done({ section: name }, section.message, { menuAction: section.menuAction });
      },
    });
  }
}
