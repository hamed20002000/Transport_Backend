/**
 * سیاست تلاش مجدد ارسال اعلان بار در تلگرام/واتساپ.
 * فاصله‌ها ۱، ۲، ۴، ۸ دقیقه‌اند؛ بعد از ۵ تلاش یا وقتی اعلان از ۳۰ دقیقه
 * قدیمی‌تر شد دیگر ارسال نمی‌شود، چون بار احتمالاً دیگر موجود نیست.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

export const DELIVERY_RETRY_WINDOW_MS = 30 * 60 * 1000;

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
