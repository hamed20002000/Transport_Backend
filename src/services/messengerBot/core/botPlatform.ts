import { ConfigService } from '@nestjs/config';
import { CommunicationProvider } from '../../../domain/enums/subscription';

/**
 * پیام‌رسان‌هایی که ربات اصلی (منو، خرید اشتراک، agent، اعلان‌ها) روی آن‌ها
 * اجرا می‌شود. کل منطق ربات یک بار نوشته شده (برای تلگرام) و MultiBot
 * پیام‌ها را بر اساس پیشوند شناسه به پیام‌رسان درست می‌فرستد.
 */
export const BOT_PLATFORMS = ['telegram', 'bale', 'rubika'] as const;
export type BotPlatform = (typeof BOT_PLATFORMS)[number];

const SEPARATOR = ':';

/**
 * شناسه‌ی سراسری کاربر/چت/فایل. تلگرام بدون پیشوند می‌ماند تا داده‌های قبلی
 * (BotLink، session، سفارش‌ها) دست نخورند؛ بقیه پیشوند می‌گیرند
 * (bale:123، rubika:b0xyz) تا با شناسه‌های عددی تلگرام قاطی نشوند.
 */
export function toBotId(platform: BotPlatform, raw: string | number): string {
  return platform === 'telegram' ? String(raw) : `${platform}${SEPARATOR}${raw}`;
}

export function parseBotId(id: string | number): { platform: BotPlatform; raw: string } {
  const value = String(id);
  const index = value.indexOf(SEPARATOR);
  if (index > 0) {
    const platform = value.slice(0, index) as BotPlatform;
    if ((BOT_PLATFORMS as readonly string[]).includes(platform) && platform !== 'telegram') {
      return { platform, raw: value.slice(index + 1) };
    }
  }
  return { platform: 'telegram', raw: value };
}

export function botPlatformOf(id: string | number): BotPlatform {
  return parseBotId(id).platform;
}

export const BOT_PLATFORM_LABEL: Record<BotPlatform, string> = {
  telegram: 'تلگرام',
  bale: 'بله',
  rubika: 'روبیکا',
};

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

/**
 * فضای نام کلیدهای Redis ربات. قبلاً شناسه‌ی ربات تلگرام بود و هست؛ اگر
 * فقط بله/روبیکا تنظیم شده باشد (تلگرام فیلتر/غیرفعال) ثابت 'bot' می‌شود.
 */
export function botNamespace(config: ConfigService): string {
  return config.get<string>('TELEGRAM_BOT_TOKEN', '').split(':')[0] || 'bot';
}
