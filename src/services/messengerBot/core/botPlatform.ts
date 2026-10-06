import { ConfigService } from '@nestjs/config';
import { CommunicationProvider } from '../../../domain/enums/subscription';

/**
 * پیام‌رسان‌هایی که ربات اصلی (منو، خرید اشتراک، agent، اعلان‌ها) روی آن‌ها
 * اجرا می‌شود. کل منطق ربات یک بار نوشته شده (برای تلگرام) و MultiBot
 * پیام‌ها را بر اساس پیشوند شناسه به پیام‌رسان درست می‌فرستد.
 */
export const BOT_PLATFORMS = ['telegram', 'bale', 'rubika'] as const;

 
export type BotPlatform = (typeof BOT_PLATFORMS)[number];//در حقیقت معادل telegram|bale|rubika است  

const SEPARATOR = ':';

/**
 * شناسه‌ی سراسری کاربر/چت/فایل. تلگرام بدون پیشوند می‌ماند تا داده‌های قبلی
 * (BotLink، session، سفارش‌ها) دست نخورند؛ بقیه پیشوند می‌گیرند
 * (bale:123، rubika:b0xyz) تا با شناسه‌های عددی تلگرام قاطی نشوند.
 */

//#region ------------------ برای هر بات شناسه سراسری میسازه به صورت platform:nativeId بجز تلگرام که فقط nativeId میمونه ------------------ 
export function toBotId(platform: BotPlatform, nativeId: string | number): string {
  return platform === 'telegram' ? String(nativeId) : `${platform}${SEPARATOR}${nativeId}`;
}
//#endregion ------------------------------------------------------------------------------------

//#region ------------------ برای هر شناسه سراسری بات، platform و nativeId رو جدا میکنه ------------------
export function parseBotId(botId: string | number): { platform: BotPlatform; nativeId: string } {
  const value = String(botId);
  const index = value.indexOf(SEPARATOR);
  if (index > 0) {
    const platform = value.slice(0, index) as BotPlatform;
    if ((BOT_PLATFORMS as readonly string[]).includes(platform) && platform !== 'telegram') {
      return { platform, nativeId: value.slice(index + 1) };
    }
  }
  return { platform: 'telegram', nativeId: value };
}
//#endregion --------------------------------------------------------------------------------------


//#region ------------------- پلتفرم بات رو به دست میاره:تلگام یا روبیکا یا بله ------------------------
export function botPlatformOf(id: string | number): BotPlatform {
  return parseBotId(id).platform;
}
//#endregion -------------------------------------------------------------------------------------------


//#region -------------------- نگاشت بات ها به رشته ------------------------------------------------------
export const BOT_PLATFORM_LABEL: Record<BotPlatform, string> = {
  telegram: 'تلگرام',
  bale: 'بله',
  rubika: 'روبیکا',
};
//#endregion ----------------------------------------------------------------------------------------------


//#region --------------------- نگاشت آیدی ساخته شده در toBotId به بات مربوطه ---------------------------------------------------
export function communicationProviderOf(id: string | number): CommunicationProvider {
  switch (botPlatformOf(id)) {
    case 'bale':
      return CommunicationProvider.Bale;
    case 'rubika':
      return CommunicationProvider.Rubika;
    default:
      return CommunicationProvider.Telegram;
  }
}
//#endregion -------------------------------------------------------------------------------------------------

/**
 * فضای نام کلیدهای Redis ربات. قبلاً شناسه‌ی ربات تلگرام بود و هست؛ اگر
 * فقط بله/روبیکا تنظیم شده باشد (تلگرام فیلتر/غیرفعال) ثابت 'bot' می‌شود.
 */

//#region --------------------- ساخت پیشوند برای اطلاعات بات ها در redis که همون ایدی تلگرام هست ---------------------------------------------------
export function botNamespace(config: ConfigService): string {
  return config.get<string>('TELEGRAM_BOT_TOKEN', '').split(':')[0] || 'bot';
}
//#endregion -------------------------------------------------------------------------------------------------
