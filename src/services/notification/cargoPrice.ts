/**
 * The freight («کرایه») of a load is free text, as the company wrote it: «۴۵ میلیون»، «۹۸۰۰۰۰۰۰ تومان»،
 * «1900دلار»، «شصت میلیون»، «نقدی». This reads the amount and currency out of it for the admin's totals.
 * Without a currency it is tomans (how freight is quoted in Iran); rials are converted to tomans. A range
 * («۴۰ تا ۴۵ میلیون») counts as its first figure. Text with no amount («نقدی», «توافقی») gives null.
 */
export type CargoPriceCurrency = 'IRT' | 'USD' | 'EUR' | 'AED' | 'TRY';

export interface CargoPrice {
  amount: number;
  currency: CargoPriceCurrency;
}

const DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const WORDS: Record<string, number> = {
  یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10,
  یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  صد: 100, یکصد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500, ششصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900,
};

// a bare figure below this (no unit, no «میلیون») is not a believable freight in tomans
const MIN_BARE_TOMANS = 1_000_000;

const SCALES: [RegExp, number][] = [
  [/میلیارد|ملیارد/, 1e9],
  [/میلیون|ملیون|م\b/, 1e6],
  [/هزار|k\b/i, 1e3],
];

const CURRENCIES: [RegExp, CargoPriceCurrency][] = [
  [/دلار|\$|usd/i, 'USD'],
  [/یورو|€|eur/i, 'EUR'],
  [/درهم|aed/i, 'AED'],
  [/لیر|try/i, 'TRY'],
];

/** «شصت و پنج» → 65: Persian number words joined with «و». */
function wordsValue(text: string): number | null {
  const parts = text.split(/\s+و\s+|\s+/).filter((part) => part in WORDS);
  return parts.length ? parts.reduce((sum, part) => sum + WORDS[part], 0) : null;
}

export function parseCargoPrice(raw: string | null | undefined): CargoPrice | null {
  if (!raw) return null;
  const text = raw.replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]).replace(/[٬,،](?=\d{3})/g, '').replace(/٫/g, '.').trim();
  const currency = CURRENCIES.find(([pattern]) => pattern.test(text))?.[1] ?? 'IRT';

  const digits = text.match(/\d+(?:\.\d+)?/);
  let value = digits ? Number(digits[0]) : wordsValue(text);
  if (value === null || !Number.isFinite(value) || value <= 0) return null;

  // the scale word after the figure; in a range («۴۰ تا ۴۵ میلیون») it is written once, for both ends
  const tail = digits ? text.slice(text.indexOf(digits[0]) + digits[0].length) : text;
  const scale = SCALES.find(([pattern]) => pattern.test(tail))?.[1] ?? 1;
  // «26000» with no unit and no scale: dollars? thousands of tomans? Too small to be tomans as written,
  // so it is left out of the totals rather than guessed
  const unitWritten = currency !== 'IRT' || /تومان|ریال/.test(text);
  if (!unitWritten && scale === 1 && value < MIN_BARE_TOMANS) return null;
  value *= scale;
  if (currency === 'IRT' && /ریال/.test(text)) value /= 10;
  return { amount: Math.round(value), currency };
}
