/**
 * جواب کوتاه کاربر به سؤال «کدوم گزینه؟» یا «انجام بدم؟» -- تایپی یا ویس.
 * راننده پشت فرمون تایپ نمی‌کنه؛ «اولی»، «دو»، «آره» یا «لغو کن» باید کافی باشه.
 * whisper معمولاً نقطه و «.» اضافه می‌کنه و گاهی «گزینه‌ی» یا «شماره‌ی» جلوش میاد.
 */

// همراه با هم‌آواهایی که whisper جای عدد کوتاه می‌نویسد («دو» → «تو»، «سه» → «صه»)؛ فقط وقتی
// کل جواب همین یک کلمه (یا «گزینه …») است، پس جمله‌ی عادی («تو تهران») عدد حساب نمی‌شود.
const ORDINALS: [RegExp, number][] = [
  [/^(?:1|یک|یه|یکی|اول|اولی|اولین|یکم|یگ)$/, 1],
  [/^(?:2|دو|دوتا|دوم|دومی|دومین|تو|توو|دوو|تومی)$/, 2],
  [/^(?:3|سه|سوم|سومی|سومین|صه|ثه)$/, 3],
  [/^(?:4|چهار|چار|چهارم|چهارمی|چهارمین)$/, 4],
  [/^(?:5|پنج|پنجم|پنجمی|پنجمین|پنچ)$/, 5],
  [/^(?:6|شش|شیش|ششم|ششمی|ششمین)$/, 6],
  [/^(?:7|هفت|هفتم|هفتمی|هفتمین|حفت)$/, 7],
  [/^(?:8|هشت|هشتم|هشتمی|هشتمین|حشت)$/, 8],
  // «نه» تنها جواب «خیر» است، نه عدد ۹
  [/^(?:9|نهم|نهمی|نهمین)$/, 9],
  [/^(?:10|ده|دهم|دهمی|دهمین)$/, 10],
  [/^(?:11|یازده|یازدهم|یازدهمی)$/, 11],
  [/^(?:12|دوازده|دوازدهم|دوازدهمی)$/, 12],
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
  const exact = ordinal(value);
  if (exact !== null) return exact;
  // whisper «گزینه» را گاهی «وزینه»/«گزینهٔ» می‌شنود و عدد بعدش درست است: «وزینه دو» → ۲
  const words = value.split(' ');
  if (words.length === 2 && CHOICE_PREFIXES.some((prefix) => distance(words[0], prefix) <= 2)) return ordinal(words[1]);
  return null;
}

const CHOICE_PREFIXES = ['گزینه', 'شماره'];

function ordinal(value: string): number | null {
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

const NUMBER_WORDS = ['یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده'];

/** prompt whisper وقتی منوی شماره‌دار باز است: «گزینه یک، گزینه دو…» و متن گزینه‌ها تا جواب کوتاه درست شنیده شود. */
export function voiceMenuPrompt(labels: string[]): string {
  const numbers = labels.map((_, i) => `گزینه ${NUMBER_WORDS[i] ?? i + 1}`).join('، ');
  return `${numbers}. ${labels.map(letters).filter(Boolean).join('، ')}.`;
}

/**
 * گزینه‌ای که اسمش گفته شد («سفر فعال»، «رد شدن»): متن گفته‌شده با برچسب گزینه‌ها مقایسه
 * می‌شود؛ فقط وقتی یک گزینه آشکارا نزدیک‌تر از بقیه است. null اگر مطمئن نبود.
 */
export function matchOptionLabel(text: string, labels: string[]): number | null {
  const said = letters(text);
  if (said.length < 3) return null;
  const scores = labels.map((label) => {
    const name = letters(label);
    if (!name) return 0;
    if (name === said || (said.length >= 4 && (name.includes(said) || said.includes(name)))) return 1;
    return 1 - distance(said, name) / Math.max(said.length, name.length);
  });
  const best = Math.max(...scores);
  const index = scores.indexOf(best);
  const second = Math.max(0, ...scores.filter((_, i) => i !== index));
  return best >= 0.6 && best - second >= 0.15 ? index + 1 : null;
}

/** فقط حروف (بدون ایموجی، علامت و فاصله) برای مقایسه */
function letters(text: string): string {
  return normalize(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
