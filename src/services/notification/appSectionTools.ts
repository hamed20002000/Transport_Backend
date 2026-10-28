import { Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import { COMPANY_ROLES, fa, numbered, textParam, ToolContext, ToolGenerator, ToolParam } from 'src/application/services/agent/tools/toolKit';
import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { TripAction } from 'src/domain/constants/bot/TripAction';
import { CargoRequest } from 'src/domain/entities/notification/CargoRequest';
import trip from 'src/i18n/fa/trip.json';
import { MarketAction } from '../market/marketBot.service';
import { CargoTripService } from './cargoTrip.service';

const DRIVER = ['DRIVER'];
const DRIVER_AND_COMPANY = ['DRIVER', ...COMPANY_ROLES];
// items written in the web answer; the rest are counted («… و ۵ مورد دیگر»)
const SHOWN = 10;

interface AppSection {
  roles: string[];
  /** the bot page (opened in the messengers through RequestResult.menuAction) */
  menuAction: string;
  /** the answer where there is no bot page (web chat): what it is and where to find it */
  message: string;
  /**
   * A page that is a list: the web answer is the list itself (or that there is none), read from the same service
   * as the bot page, followed by `message` (where to act on it).
   */
  read?: (trips: CargoTripService, userId: string) => Promise<string>;
}

/** «۱. …» lines with the count above and «… و ۵ مورد دیگر» below */
function listText(title: string, total: number, lines: string[]): string {
  const more = total > lines.length ? `… و ${fa(total - lines.length)} مورد دیگر` : '';
  return [`${title} (${fa(total)}):`, numbered(lines), more].filter(Boolean).join('\n');
}

/** «نام راننده (شماره) ← تبریز به تهران · … · کد TRB…» */
async function withDriver(trips: CargoTripService, request: CargoRequest): Promise<string> {
  return `${trips.describe(await trips.contact(request.driverUserId))} ← ${trips.cargoTitle(request)}`;
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
    message: 'جزئیات و ثبت تحویل در پنل وب، تب «سفر فعال» است.',
    read: async (trips, userId) => {
      const active = await trips.activeTrips(userId);
      if (!active.length) return 'سفر فعالی ندارید.';
      return listText('سفر فعال شما', active.length, active.map((request) =>
        `${trips.cargoTitle(request)}${request.deliveryReportedAt ? ' · تحویل را اعلام کرده‌اید؛ منتظر تأیید شرکت حمل‌ونقل' : ''}`));
    },
  },
  return_loads: {
    roles: DRIVER,
    menuAction: TripAction.ReturnLoads,
    message: 'بارهای برگشتی از مقصد سفرتان در ربات پیام‌رسان («بار برگشتی») و در جزئیات هر بار در وب است.',
  },
  my_requests: {
    roles: DRIVER,
    menuAction: `${TripAction.DriverRequests}1`,
    message: 'برای لغو درخواست، پنل وب، تب «درخواست‌ها».',
    read: async (trips, userId) => {
      const [items, total] = await trips.driverRequests(userId, 1, SHOWN);
      if (!total) return 'درخواست باری ثبت نکرده‌اید.';
      return listText('درخواست‌های بار شما', total, items.map((request) =>
        `${trips.cargoTitle(request)} · ${trip.status[request.status as keyof typeof trip.status] ?? request.status}`));
    },
  },
  company_active_trips: {
    roles: COMPANY_ROLES,
    menuAction: `${TripAction.CompanyTrips}1`,
    message: 'موقعیت راننده‌ها و ثبت تحویل در پنل وب، تب «سفرها» است.',
    read: async (trips, userId) => {
      const [items, total] = await trips.companyTrips(userId, 1, SHOWN);
      if (!total) return 'هیچ‌کدام از رانندگان شما الان سفر فعالی ندارند.';
      const lines = await Promise.all(items.map(async (request) =>
        `${await withDriver(trips, request)}${request.deliveryReportedAt ? ' · راننده تحویل را اعلام کرده؛ منتظر تأیید شما' : ''}`));
      return listText('سفرهای فعال رانندگان شما', total, lines);
    },
  },
  company_driver_requests: {
    roles: COMPANY_ROLES,
    menuAction: `${TripAction.CompanyRequests}1`,
    message: 'برای پذیرفتن یا رد درخواست‌ها، پنل وب، تب «درخواست‌ها».',
    read: async (trips, userId) => {
      const [items, total] = await trips.companyRequests(userId, 1, SHOWN);
      if (!total) return 'درخواستی از رانندگان برای بارهای شما در انتظار جواب نیست.';
      const lines = await Promise.all(items.map((request) => withDriver(trips, request)));
      return listText('درخواست‌های رانندگان برای بارهای شما، در انتظار جواب', total, lines);
    },
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
    private readonly trips: CargoTripService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند
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
        // the messengers open the bot page instead; the web (and a messenger without that page) gets this text
        const content = section.read ? await section.read(self.trips, ctx.userId) : '';
        return ctx.done({ section: name }, [content, section.message].filter(Boolean).join('\n\n'), { menuAction: section.menuAction });
      },
    });
  }
}
