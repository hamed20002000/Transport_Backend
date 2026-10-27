import { BotCallback } from '../constants/bot/BotCallback';

/**
 * منوهای شرکت حمل‌ونقل که شرکت غیرمادر جداگانه می‌خرد (CompanyFeaturePlan). خانه، پروفایل، فیلتر نمایش بار،
 * قیمت بازار، اشتراک و پشتیبانی همیشه باز‌اند و اینجا نیستند. شرکت مادر (User.isParentCompany) همه را دارد.
 */
export enum CompanyFeature {
  /** پیشنهادها: بارهای کانال‌ها برای شرکت */
  Suggestions = 'SUGGESTIONS',
  /** ثبت بار (فرم، اکسل، انتشار پیشنهاد) */
  CreateLoad = 'CREATE_LOAD',
  /** بارهای منتشرشده و اعلام دوباره */
  PublishedLoads = 'PUBLISHED_LOADS',
  /** درخواست‌های رانندگان و سپردن بار */
  DriverRequests = 'DRIVER_REQUESTS',
  /** سفرهای فعال و ثبت تحویل */
  Trips = 'TRIPS',
  /** فهرست رانندگان */
  Drivers = 'DRIVERS',
  /** کانال‌های شرکت */
  Channels = 'CHANNELS',
  /** دستیار هوشمند (متن و صوت در وب، ربات‌ها و واتساپ) */
  Agent = 'AGENT',
  /** کارخانه‌ها: لینک دعوت و بارهایی که کارخانه‌ها مستقیم برای شرکت می‌فرستند */
  Factories = 'FACTORIES',
}

export const COMPANY_FEATURE_TITLES: Record<CompanyFeature, string> = {
  [CompanyFeature.Suggestions]: 'پیشنهادها',
  [CompanyFeature.CreateLoad]: 'ثبت بار',
  [CompanyFeature.PublishedLoads]: 'بارهای منتشرشده',
  [CompanyFeature.DriverRequests]: 'درخواست‌ها',
  [CompanyFeature.Trips]: 'سفرها',
  [CompanyFeature.Drivers]: 'رانندگان',
  [CompanyFeature.Channels]: 'کانال‌ها',
  [CompanyFeature.Agent]: 'دستیار هوشمند',
  [CompanyFeature.Factories]: 'کارخانه‌ها',
};

/**
 * ابزار دستیار → منویی که همان کار را در پنل می‌کند؛ شرکتی که دستیار را دارد ولی آن منو را نه، با دستیار
 * هم آن کار را نمی‌کند. ابزار بی‌منو (فیلتر، پروفایل، اشتراک، مرز) آزاد است.
 */
export const COMPANY_FEATURE_BY_AGENT_TOOL: Record<string, CompanyFeature> = {
  list_company_suggested_cargo: CompanyFeature.Suggestions,
  count_company_unread_suggestions: CompanyFeature.Suggestions,
  mark_company_suggestions_read: CompanyFeature.Suggestions,
  publish_company_suggested_cargo: CompanyFeature.Suggestions,
  create_company_cargo: CompanyFeature.CreateLoad,
  import_company_cargo_excel: CompanyFeature.CreateLoad,
  list_company_my_cargo: CompanyFeature.PublishedLoads,
  mark_company_cargo_taken: CompanyFeature.PublishedLoads,
  reopen_company_cargo: CompanyFeature.PublishedLoads,
  list_company_channels: CompanyFeature.Channels,
  add_company_channel: CompanyFeature.Channels,
  delete_company_channel: CompanyFeature.Channels,
};

/** بخش‌های open_app_section که صفحه‌ی یک منوی پولی‌اند. */
export const COMPANY_FEATURE_BY_APP_SECTION: Record<string, CompanyFeature> = {
  company_active_trips: CompanyFeature.Trips,
  company_driver_requests: CompanyFeature.DriverRequests,
};

/** دکمه‌ی منوی ربات‌ها و واتساپ → منویی که باز می‌کند (همان قفل پنل وب). */
export const COMPANY_FEATURE_BY_MENU_ACTION: Record<string, CompanyFeature> = {
  [BotCallback.CompanyLoads]: CompanyFeature.Suggestions,
  [BotCallback.CompanyCreateLoad]: CompanyFeature.CreateLoad,
  [BotCallback.CompanyDriverRequests]: CompanyFeature.DriverRequests,
  [BotCallback.CompanyActiveTrips]: CompanyFeature.Trips,
  [BotCallback.CompanyChannels]: CompanyFeature.Channels,
};
