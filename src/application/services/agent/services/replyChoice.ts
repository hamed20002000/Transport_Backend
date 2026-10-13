/**
 * جواب کوتاه کاربر به سؤال «کدوم گزینه؟» یا «انجام بدم؟» -- تایپی یا ویس.
 * راننده پشت فرمون تایپ نمی‌کنه؛ «اولی»، «دو»، «آره» یا «لغو کن» باید کافی باشه.
 * whisper معمولاً نقطه و «.» اضافه می‌کنه و گاهی «گزینه‌ی» یا «شماره‌ی» جلوش میاد.
 */

const ORDINALS: [RegExp, number][] = [
  [/^(?:1|یک|یه|یکی|اول|اولی|اولین|یکم)$/, 1],
  [/^(?:2|دو|دوتا|دوم|دومی|دومین)$/, 2],
  [/^(?:3|سه|سوم|سومی|سومین)$/, 3],
  [/^(?:4|چهار|چار|چهارم|چهارمی|چهارمین)$/, 4],
  [/^(?:5|پنج|پنجم|پنجمی|پنجمین)$/, 5],
];

// جواب بله/نه کلمه‌به‌کلمه بررسی می‌شه («نه، لغو کن»، «بله انجامش بده»): حداقل یک کلمه‌ی اصلی،
// بقیه فقط کلمه‌های کمکی -- جمله‌ی دیگه («نه، بار تهران رو بیار») جواب حساب نمی‌شه.
const YES_WORDS = new Set(['بله', 'بلی', 'آره', 'اره', 'آری', 'باشه', 'اوکی', 'ok', 'okay', 'حتما', 'حتماً', 'درسته', 'انجام', 'انجامش', 'بزن', 'تایید', 'تأیید', 'موافقم']);
const NO_WORDS = new Set(['نه', 'نخیر', 'خیر', 'لغو', 'لغوش', 'کنسل', 'بیخیال', 'بی', 'خیال', 'ولش', 'نمیخوام', 'نمی', 'خوام', 'اشتباهه', 'اشتباه', 'نده', 'نکن']);
const FILLER_WORDS = new Set(['کن', 'بکن', 'کنید', 'بده', 'بدید', 'میکنم', 'می', 'کنم', 'رو', 'را', 'لطفا', 'لطفاً', 'دیگه', 'همینو', 'همین', 'است', 'هست', 'شد']);

function normalize(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[.،,!؟?:؛)\-]+/g, ' ')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // «گزینه‌ی دو»، «شماره ۲»، «همون اولی» -- فقط خود عدد مهمه
    .replace(/^(?:گزینه ی|گزینهٔ|گزینه|شماره ی|شماره|همون|همان|بار)\s+/, '')
    .replace(/\s+(?:رو|را|و)?\s*(?:بزن|انتخاب کن|میخوام|می خوام)$/, '')
    .trim();
}

/** شماره‌ی گزینه (از ۱)، یا null اگه جواب گزینه نبود. */
export function parseChoice(text: string): number | null {
  const value = normalize(text);
  for (const [pattern, choice] of ORDINALS) if (pattern.test(value)) return choice;
  return null;
}

/** جواب بله/نه -- true، false، یا null اگه هیچ‌کدوم نبود. */
export function parseYesNo(text: string): boolean | null {
  const words = normalize(text).toLowerCase().split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  const yes = words.some((w) => YES_WORDS.has(w));
  const no = words.some((w) => NO_WORDS.has(w));
  if (yes === no) return null;
  const allowed = yes ? YES_WORDS : NO_WORDS;
  return words.every((w) => allowed.has(w) || FILLER_WORDS.has(w)) ? yes : null;
}
