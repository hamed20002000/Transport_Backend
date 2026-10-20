import { IRAN_PROVINCES } from 'src/domain/helper/iranProvinces';

/**
 * whisper اسم شهرهای کم‌کاربرد را با یکی دو صدای نزدیک می‌نویسد («علشتر»، «جلوستان»، «برگان»، «مرن»).
 * اسمی که در جای «شهر» جمله آمده و خودش شهر نیست، با نزدیک‌ترین شهر/استانی که از نظر صدا خیلی نزدیک است
 * عوض می‌شود؛ فقط اگر آن شهر یکتا باشد.
 */

const normalize = (word: string) => word.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌‏]/g, '');

// اسم‌های یک‌کلمه‌ای؛ اسم چندکلمه‌ای («بندر امام خمینی») فقط همان‌طور که هست شناخته می‌شود
const PLACES = [...new Set(IRAN_PROVINCES.flatMap((province) => [...province.names, ...province.cities]).map(normalize))].filter(
  (name) => !name.includes(' '),
);
const PLACE_SET = new Set(PLACES);

// حرف‌هایی که whisper جابه‌جا می‌شنود: هم‌آوا، واک‌دار/بی‌واک، «گ» پیش از مصوت جلو مثل «ج»، همزه/عین
const SOUND_ALIKE = ['تدطچج', 'سصثزذضظ', 'کگقغ', 'گج', 'پب', 'هح', 'اعآئأ'];
const VOWEL_LETTERS = 'اوی';
const alike = (a: string, b: string) => SOUND_ALIKE.some((group) => group.includes(a) && group.includes(b));

/** فاصله‌ی شنیداری: جابه‌جایی هم‌آوا و افتادن/اضافه شدن حرف مصوت نصف هزینه دارد. */
export function soundDistance(a: string, b: string): number {
  const gap = (letter: string) => (VOWEL_LETTERS.includes(letter) ? 0.5 : 1);
  const row = [0];
  for (let j = 1; j <= b.length; j++) row[j] = row[j - 1] + gap(b[j - 1]);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] += gap(a[i - 1]);
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      const swap = a[i - 1] === b[j - 1] ? 0 : alike(a[i - 1], b[j - 1]) ? 0.5 : 1;
      row[j] = Math.min(row[j] + gap(a[i - 1]), row[j - 1] + gap(b[j - 1]), previous + swap);
      previous = current;
    }
  }
  return row[b.length];
}

// سه‌حرفی: فقط یک جابه‌جایی هم‌آوا یا مصوت («این» ← «ایوان» و «بار» ← «لار» نه)؛ تا پنج حرف یک تغییر کامل؛
// بلندتر یک و نیم (مثلاً دو تغییر هم‌آوا و یک مصوت)
const allowed = (length: number) => (length <= 3 ? 0.5 : length <= 5 ? 1 : 1.5);
// جدا از نزدیک‌ترین بعدی، تا اسم بین دو شهر حدس زده نشود
const MARGIN = 0.5;

function nearestPlace(word: string): string | undefined {
  if (word.length < 3 || PLACE_SET.has(word) || PLACE_BEFORE.has(word)) return undefined;
  const scored = PLACES.map((place) => ({ place, distance: soundDistance(word, place) })).sort((a, b) => a.distance - b.distance);
  const [best, second] = scored;
  if (!best || best.distance > allowed(word.length)) return undefined;
  if (second && second.distance - best.distance < MARGIN) return undefined;
  return best.place;
}

// کلمه‌هایی که بعدشان جای اسم شهر است
const PLACE_BEFORE = new Set(['از', 'به', 'تا', 'مبدا', 'مبدأ', 'مقصد', 'بار', 'بارهای', 'بارای', 'شهر', 'استان', 'سمت']);
const PUNCTUATION = /^([.،,؟!:؛«»"]*)(.*?)([.،,؟!:؛«»"]*)$/u;

/**
 * اسم شهری که whisper با صدای نزدیک نوشته را درست می‌کند، فقط وقتی کلمه در جای شهر آمده:
 * بعد از «از/به/بار/مبدا/…»، یا کنار اسم شهر دیگر («مرند تبریز»، «X به گلستان»).
 */
export function fixMisheardPlaces(text: string): string {
  const parts = text.split(/(\s+)/);
  // the split keeps the spaces as their own parts; only the words count as neighbours
  const wordAt = parts
    .map((part, i) => ({ i, word: normalize(PUNCTUATION.exec(part)?.[2] ?? part).trim() }))
    .filter(({ word }) => word);
  const isPlace = (k: number) => k >= 0 && k < wordAt.length && PLACE_SET.has(wordAt[k].word);

  wordAt.forEach(({ i, word }, k) => {
    const previous = wordAt[k - 1]?.word;
    const next = wordAt[k + 1]?.word;
    const inSlot =
      (previous !== undefined && PLACE_BEFORE.has(previous)) ||
      isPlace(k - 1) ||
      isPlace(k + 1) ||
      (next === 'به' && isPlace(k + 2));
    if (!inSlot) return;
    const place = nearestPlace(word);
    if (!place) return;
    const [, lead, , trail] = PUNCTUATION.exec(parts[i]) ?? [];
    parts[i] = `${lead ?? ''}${place}${trail ?? ''}`;
    wordAt[k] = { i, word: place };
  });
  return parts.join('');
}
