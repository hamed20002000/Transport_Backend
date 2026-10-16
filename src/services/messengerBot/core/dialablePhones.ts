// شماره‌ی ایرانی در متن (با رقم فارسی/عربی هم): 0 یا +98 یا 0098 و بعد ۱۰ رقم؛ فاصله یا خط تیره بین رقم‌ها مجاز.
const PHONE = /(?<![\d۰-۹٠-٩+])(?:\+98|0098|[0۰٠])(?:[\s-]?[\d۰-۹٠-٩]){10}(?![\d۰-۹٠-٩])/g;

const latin = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

/**
 * پیام‌رسان‌ها (تلگرام، بله، روبیکا، واتساپ) فقط شماره‌ی بین‌المللی را قابل لمس برای تماس می‌کنند؛
 * «09121234567» یا «021 8888 7777» در متن به «+989121234567» و «+982188887777» تبدیل می‌شود.
 */
export function dialablePhones(text: string): string;
export function dialablePhones(text: string | undefined): string | undefined;
export function dialablePhones(text: string | undefined): string | undefined {
  if (!text) return text;
  return text.replace(PHONE, (raw) => `+98${latin(raw).replace(/\D/g, '').slice(-10)}`);
}
