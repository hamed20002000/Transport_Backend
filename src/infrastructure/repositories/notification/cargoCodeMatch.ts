/**
 * شرط SQL برای پیدا کردن بار با کدی که کاربر گفت (خروجی codeParam: فقط حرف و رقم، بزرگ).
 * کد ذخیره‌شده هم با همان قاعده تمیز می‌شود، پس فرمت کد (پیشوند، خط تیره، طول) هر چه
 * باشد لازم نیست اینجا یا در توضیح ابزارها تغییر کند. اگر کاربر فقط عدد گفت، با رقم‌های
 * کد مقایسه می‌شود («۱۰۰۰۰۵» همان «TRB-100005» است).
 */
export function cargoCodeMatch(column: string, code: string): { sql: string; params: { code: string } } {
  const digitsOnly = /^\d+$/.test(code);
  const sql = digitsOnly
    ? `regexp_replace(${column}, '[^0-9]', '', 'g') = :code`
    : `UPPER(regexp_replace(${column}, '[^A-Za-z0-9]', '', 'g')) = :code`;
  return { sql, params: { code } };
}
