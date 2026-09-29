import { normalizePersianText } from './persianText';

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/میلیارد|ملیارد/, 1_000_000_000],
  [/میلیون|ملیون/, 1_000_000],
  [/هزار/, 1_000],
];

/**
 * کرایه‌ی متن آزاد (خروجی مدل) به تومان؛ اگر عددی پیدا نشود null.
 * «۴۵ میلیون تومان» → 45000000، «۶۰۰٬۰۰۰ ریال» → 60000، «۴۰ تا ۴۵ میلیون» → 40000000.
 * بدون واحد، تومان فرض می‌شود. در بازه‌ها عدد اول (کف) ملاک است.
 */
export function parsePriceToman(text: string | null | undefined): number | null {
  if (!text) return null;
  const normalized = normalizePersianText(text)
    // جداکننده‌ی هزارگان بین ارقام: 600,000 / 600٬000 / 600 000
    .replace(/(\d)[,٬'’ ](?=\d{3}(\D|$))/g, '$1')
    .replace(/٫/g, '.');

  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match || match.index === undefined) return null;

  let amount = Number(match[0]);
  // ضریب اولین کلمه‌ای است که بعد از عدد آمده («۴۰ تا ۴۵ میلیون» هم میلیون حساب می‌شود).
  const rest = normalized.slice(match.index + match[0].length);
  const multiplier = MULTIPLIERS.map(([pattern, value]) => ({ at: rest.search(pattern), value }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (multiplier) amount *= multiplier.value;

  if (/ریال/.test(normalized)) amount /= 10;
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
}
