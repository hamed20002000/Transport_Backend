/**
 * سیاست تلاش مجدد ارسال اعلان بار در پیام‌رسان‌ها.
 * فاصله‌ها ۱، ۲، ۴، ۸ دقیقه‌اند؛ بعد از ۵ تلاش یا وقتی اعلان از ۳ ساعت
 * قدیمی‌تر شد دیگر ارسال نمی‌شود، چون بار احتمالاً دیگر موجود نیست. (یک بار برای
 * هزاران راننده با سرعت مجاز هر پیام‌رسان تا حدود یک ساعت در صف ارسال است.)
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

export const DELIVERY_RETRY_WINDOW_MS = 3 * 60 * 60 * 1000;

const BASE_RETRY_DELAY_MS = 60 * 1000;

/**
 * زمان تلاش بعدی، یا null اگر نباید دوباره امتحان شود.
 * attempts تعداد تلاش‌های انجام‌شده تا الان است (همین تلاش ناموفق هم شمرده شده).
 */
export function nextDeliveryRetryAt(attempts: number, createdAt: Date, now = new Date()): Date | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;

  const next = new Date(now.getTime() + BASE_RETRY_DELAY_MS * 2 ** (attempts - 1));
  return next.getTime() <= createdAt.getTime() + DELIVERY_RETRY_WINDOW_MS ? next : null;
}

/**
 * خطاهایی که تکرار فایده ندارد: 403 (کاربر ربات را block کرده) و 400
 * (chat پیدا نشد، متن نامعتبر و ...). 429 و خطای شبکه موقت‌اند.
 */
export function isPermanentTelegramError(error: unknown): boolean {
  const response = (error as { response?: { statusCode?: number; body?: { error_code?: number } } })?.response;
  const code = response?.body?.error_code ?? response?.statusCode;
  return code === 400 || code === 403;
}

/**
 * «Too many requests» from a messenger (Telegram and Bale 429 with retry_after; Rubika TOO_REQUESTS, given the same
 * shape): how long to wait before the next send, or null for any other error.
 */
export function rateLimitWaitMs(error: unknown): number | null {
  const response = (error as { response?: { statusCode?: number; body?: { error_code?: number; parameters?: { retry_after?: number } } } })?.response;
  const code = response?.body?.error_code ?? response?.statusCode;
  if (code !== 429) return null;
  return Math.max(1, response?.body?.parameters?.retry_after ?? 5) * 1000;
}

/** ستون‌های وضعیت ارسال هر ربات در CargoNotification. */
export const BOT_DELIVERY_COLUMNS = {
  telegram: {
    status: 'telegramStatus',
    chatId: 'telegramChatId',
    messageId: 'telegramMessageId',
    attempts: 'telegramAttempts',
    nextRetryAt: 'telegramNextRetryAt',
  },
  bale: {
    status: 'baleStatus',
    chatId: 'baleChatId',
    messageId: 'baleMessageId',
    attempts: 'baleAttempts',
    nextRetryAt: 'baleNextRetryAt',
  },
  rubika: {
    status: 'rubikaStatus',
    chatId: 'rubikaChatId',
    messageId: 'rubikaMessageId',
    attempts: 'rubikaAttempts',
    nextRetryAt: 'rubikaNextRetryAt',
  },
  eitaa: {
    status: 'eitaaStatus',
    chatId: 'eitaaChatId',
    messageId: 'eitaaMessageId',
    attempts: 'eitaaAttempts',
    nextRetryAt: 'eitaaNextRetryAt',
  },
} as const;
