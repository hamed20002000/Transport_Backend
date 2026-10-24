/**
 * کد بارِ گفته‌شده در ویس («تی آر بی صد هزار و نه»، «ده هزار نه»، «TRB 1009») رو با
 * کدهای واقعی همون کاربر تطبیق می‌ده. whisper عدد رو گاهی به حروف، گاهی رقمی و
 * معمولاً با صفرهای جاافتاده می‌نویسه؛ کد فقط وقتی جایگزین می‌شه که دقیقاً یک
 * کدِ کاربر به اندازه‌ی کافی نزدیک باشه -- وگرنه null (و کاربر باید تایپ کنه).
 */

const UNITS: Record<string, number> = {
  صفر: 0, یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, چار: 4, پنج: 5, پنش: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9,
  ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, چارده: 14, پانزده: 15, پونزده: 15, شانزده: 16, شونزده: 16,
  هفده: 17, هیفده: 17, هجده: 18, هیجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  صد: 100, یکصد: 100, دویست: 200, سیصد: 300, سی‌صد: 300, چهارصد: 400, پانصد: 500, پونصد: 500,
  ششصد: 600, شیشصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900,
};
const MULTIPLIERS: Record<string, number> = { هزار: 1_000, میلیون: 1_000_000 };

// بعد از این‌ها عدد کد نیست (وزن، قیمت، تعداد).
const UNIT_AFTER = /^(تن|تُن|تون|کیلو|کیلوگرم|تومان|تومن|ریال|دستگاه|عدد|روز|ساعت|متر|درصد)$/;

const toLatinDigits = (text: string) =>
  text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/** برداشت حسابی: «صد هزار و نه» = 100009 */
function arithmetic(words: string[]): string {
  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word in MULTIPLIERS) {
      total += (current || 1) * MULTIPLIERS[word];
      current = 0;
    } else {
      current += /^\d+$/.test(word) ? Number(word) : UNITS[word];
    }
  }
  return String(total + current);
}

/**
 * یک دنباله‌ی کلمه‌های عددی رو به همه‌ی برداشت‌های رقمیِ ممکن تبدیل می‌کنه: حسابی («صد هزار و نه»
 * = 100009) و رقم‌به‌رقم («صفر صفر صفر هشت نود و یک» = 000891). در رقم‌به‌رقم، صفر و رقم‌های
 * جدا هر کدوم یک گروهن، و هر جا عدد بعدی از قبلی بزرگ‌تر باشه («هشت» بعد «نود») گروه تازه‌ست.
 */
function readings(words: string[]): string[] {
  const groups: string[] = [];
  let group: string[] = [];
  let last = Infinity;
  const flush = () => {
    if (group.length) groups.push(arithmetic(group));
    group = [];
    last = Infinity;
  };
  for (const word of words) {
    if (word === 'صفر' || /^\d+$/.test(word)) {
      flush();
      groups.push(word === 'صفر' ? '0' : word);
    } else if (word in MULTIPLIERS) {
      group.push(word);
      last = Infinity;
    } else {
      if (UNITS[word] >= last) flush();
      group.push(word);
      last = UNITS[word];
    }
  }
  flush();

  return [...new Set([arithmetic(words), groups.join('')])];
}

/** همه‌ی عددهای متن (رقمی یا به حروف) به‌همراه برداشت‌هاشون؛ عدد وزن/قیمت کنار گذاشته می‌شه. */
export function spokenNumbers(text: string): { span: string; readings: string[] }[] {
  const tokens = toLatinDigits(text)
    .replace(/[.،,؟!:؛]/g, ' ')
    // «TRB1009» و «1009تا» -- رقم از حرف جدا می‌شه
    .replace(/(\d+)/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);

  const results: { span: string; readings: string[] }[] = [];
  let run: string[] = [];
  const end = (next: string | undefined) => {
    const words = run.filter((w) => w !== 'و');
    if (words.length && !(next && UNIT_AFTER.test(next))) {
      results.push({ span: run.join(' '), readings: readings(words) });
    }
    run = [];
  };

  tokens.forEach((token, i) => {
    const isNumber = /^\d+$/.test(token) || token in UNITS || token in MULTIPLIERS;
    // «و» فقط وسط عدد («صد و نه») جزو عدده.
    const isJoiner = token === 'و' && run.length > 0 && i + 1 < tokens.length;
    if (isNumber || isJoiner) {
      run.push(token);
    } else if (run.length) {
      end(token);
    }
  });
  if (run.length) end(undefined);

  // «و» آخرِ یک دنباله جزو عدد نیست.
  return results.map((r) => ({ ...r, span: r.span.replace(/\s+و$/, '') }));
}

// حرف‌هایی که whisper در گفتار فارسی جابه‌جا می‌شنود (واک‌دار/بی‌واک، هم‌آوا): «دو» ← «تو»، «چهار» ← «تهار»
const SOUND_ALIKE = ['تدطچج', 'سصثزذضظ', 'کگقغ', 'پب', 'هح'];
// بعد از عدد مقدار: وزن، پول، تعداد خودرو؛ «روز» و «ساعت» نه، چون «تو روز» یعنی «در روز»
const QUANTITY_AFTER = /^(تن|تُن|تون|کیلو|کیلوگرم|تومان|تومن|ریال|دستگاه)$/;
const PUNCTUATION = /^([.،,؟!:؛«»"]*)(.*?)([.،,؟!:؛«»"]*)$/u;

const numberValue = (word: string): number | undefined =>
  /^\d+$/.test(word) ? Number(word) : word in UNITS ? UNITS[word] : MULTIPLIERS[word];

/** کلمه‌ی عددی‌ای که با عوض شدن یک حرف هم‌آوا به این کلمه تبدیل شده؛ فقط اگر یکی باشد. */
function soundAlikeNumber(word: string): string | undefined {
  const found = new Set<string>();
  [...word].forEach((letter, i) => {
    const group = SOUND_ALIKE.find((g) => g.includes(letter));
    for (const other of group ?? '') {
      const candidate = word.slice(0, i) + other + word.slice(i + 1);
      if (other !== letter && candidate in UNITS) found.add(candidate);
    }
  });
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * آیا عدد value در این جای جمله با کلمه‌های کنارش یک عدد درست فارسی می‌سازد:
 * پیش از هزار/میلیون/صد («دو هزار»)، پیش از واحد مقدار («دو تن»)، بعد از عدد بزرگ‌تری که جایش خالی است
 * با «و» («صد و دو») یا بدون «و» ولی پیش از عدد دیگر یا آخر جمله («سی چهار، یازده»)، یا وسط رقم‌های
 * تک‌تک یک کد («یک دو سه»).
 */
function fitsNumber(words: string[], i: number, value: number): boolean {
  const next = words[i + 1];
  const joined = words[i - 1] === 'و';
  const previous = joined ? words[i - 2] : words[i - 1];
  const before = previous === undefined ? undefined : numberValue(previous);
  const after = next === undefined ? undefined : numberValue(next);

  if (next && (next in MULTIPLIERS || (next === 'صد' && value < 10))) return true;
  if (next && QUANTITY_AFTER.test(next)) return true;
  // «سی» + «چهار»: عدد قبلی بزرگ‌تر است و رقم‌های پایینش خالی؛ از بیست به بالا («ده و دو» عدد نیست، دوازده است)
  const opensFor = before !== undefined && before >= 20 && before > value && before % 10 ** String(value).length === 0;
  if (opensFor && (joined || next === undefined || after !== undefined)) return true;
  return before !== undefined && after !== undefined && before < 10 && after < 10 && value < 10 && !joined;
}

/**
 * عددهایی که whisper با یک حرف هم‌آوای اشتباه نوشته («تو هزار»، «صد و تو»، «سی و تهار») را درست می‌کند.
 * فقط وقتی کلمه با کلمه‌های کنارش عدد درستی بسازد، تا «تو» در «بار تو تبریز» یا «تو ده روز» دست نخورد.
 */
export function fixMisheardNumbers(text: string): string {
  const parts = text.split(/(\s+)/);
  const words = parts.map((part) => toLatinDigits(PUNCTUATION.exec(part)?.[2] ?? part));
  const wordIndex = parts.map((_, i) => i).filter((i) => !/^\s*$/.test(parts[i]));
  const sequence = wordIndex.map((i) => words[i]);
  sequence.forEach((word, k) => {
    if (numberValue(word) !== undefined) return;
    const number = soundAlikeNumber(word);
    if (!number || !fitsNumber(sequence, k, UNITS[number])) return;
    const part = wordIndex[k];
    const [, lead, , trail] = PUNCTUATION.exec(parts[part]) ?? [];
    parts[part] = `${lead ?? ''}${number}${trail ?? ''}`;
    sequence[k] = number;
  });
  return parts.join('');
}

// تنها که بیایند معمولاً عدد نیستند: «یک بار از تبریز»، «نه، ثبت نکن»؛ فقط پیش از واحد مقدار («یک تن»)
const NOT_ALONE = new Set(['یک', 'یه', 'نه']);

/** یک عدد به رقم؛ «هفتصد میلیون» ← «700 میلیون» (همان شکل نوشتن قیمت)، «شش هزار» ← «6000»، «ده هزار و نه» ← «10009». */
function numberDigits(words: string[]): string {
  const last = words[words.length - 1];
  const scales = words.filter((word) => word in MULTIPLIERS);
  if (words.length > 1 && scales.length === 1 && last === 'میلیون') return `${arithmetic(words.slice(0, -1))} ${last}`;
  return arithmetic(words);
}

/**
 * دنباله‌ی کلمه‌های عددی به عددهای جدا، با همان قاعده‌ی readings: عددی که از قبلی کوچک‌تر نیست عدد
 * تازه است («سیصد و سی و چهار یازده» ← 334 و 11). دنباله‌ای که صفر دارد رقم‌به‌رقم گفته شده (کد،
 * «یک صفر صفر صفر هشت» ← 10008) و یکجا نوشته می‌شود.
 */
function runDigits(words: string[]): string {
  if (words.includes('صفر')) {
    const options = readings(words);
    return options[options.length - 1];
  }
  const numbers: string[][] = [];
  let group: string[] = [];
  let last = Infinity;
  for (const word of words) {
    const value = /^\d+$/.test(word) ? Number(word) : UNITS[word];
    if (!(word in MULTIPLIERS) && group.length && value >= last) {
      numbers.push(group);
      group = [];
    }
    group.push(word);
    last = word in MULTIPLIERS ? Infinity : value;
  }
  if (group.length) numbers.push(group);
  return numbers.map(numberDigits).join(' ');
}

/**
 * عددهای به حروف متن ویس به رقم («شصت تن» ← «60 تن»، «گزینه سه» ← «گزینه 3»)؛ مدل‌های OpenAI عدد را
 * گاهی رقمی، گاهی به حروف می‌نویسند. «و» فقط وسط عدد جزو آن است («صد و نه»)؛ علامت‌ها و فاصله‌ها می‌مانند.
 */
export function numbersToDigits(text: string): string {
  const parts = text.split(/(\s+)/);
  const word = (i: number) => toLatinDigits(PUNCTUATION.exec(parts[i])?.[2] ?? parts[i]);
  const isNumber = (w: string) => /^\d+$/.test(w) || w in UNITS || w in MULTIPLIERS;
  const wordIndex = parts.map((_, i) => i).filter((i) => !/^\s*$/.test(parts[i]));

  const out = [...parts];
  for (let k = 0; k < wordIndex.length; k++) {
    if (!isNumber(word(wordIndex[k]))) continue;
    // تا کلمه‌ی غیرعددی یا علامت («سی، چهار» دو عدد است)؛ «و» فقط اگر بعدش هم عدد باشد
    let end = k;
    while (end + 1 < wordIndex.length && !PUNCTUATION.exec(parts[wordIndex[end]])?.[3]) {
      const next = word(wordIndex[end + 1]);
      if (isNumber(next)) end++;
      else if (next === 'و' && end + 2 < wordIndex.length && isNumber(word(wordIndex[end + 2])) && !PUNCTUATION.exec(parts[wordIndex[end + 1]])?.[3]) end += 2;
      else break;
    }
    const words = wordIndex.slice(k, end + 1).map(word).filter((w) => w !== 'و');
    const after = end + 1 < wordIndex.length ? word(wordIndex[end + 1]) : undefined;
    const keep = (words.length === 1 && NOT_ALONE.has(words[0]) && !(after && QUANTITY_AFTER.test(after))) || words.every((w) => /^\d+$/.test(w));
    if (!keep) {
      const [, lead] = PUNCTUATION.exec(parts[wordIndex[k]]) ?? [];
      const [, , , trail] = PUNCTUATION.exec(parts[wordIndex[end]]) ?? [];
      out[wordIndex[k]] = `${lead ?? ''}${runDigits(words)}${trail ?? ''}`;
      for (let i = wordIndex[k] + 1; i <= wordIndex[end]; i++) out[i] = '';
    }
    k = end;
  }
  return out.join('');
}

/**
 * فاصله‌ی رقمی با تحمل صفر: whisper صفرها رو زیاد جا می‌ندازه یا اضافه می‌کنه
 * («100009» ← «1009»)، پس حذف/درج صفر نصف هزینه داره.
 */
function digitDistance(heard: string, code: string): number {
  const row = Array.from({ length: code.length + 1 }, (_, j) =>
    [...code.slice(0, j)].reduce((sum, c) => sum + (c === '0' ? 0.5 : 1), 0),
  );
  for (let i = 1; i <= heard.length; i++) {
    let previous = row[0];
    row[0] += heard[i - 1] === '0' ? 0.5 : 1;
    for (let j = 1; j <= code.length; j++) {
      const current = row[j];
      const deleteCost = heard[i - 1] === '0' ? 0.5 : 1;
      const insertCost = code[j - 1] === '0' ? 0.5 : 1;
      row[j] = Math.min(row[j] + deleteCost, row[j - 1] + insertCost, previous + (heard[i - 1] === code[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[code.length];
}

export interface CodeCandidate {
  code: string;
  label?: string;
}

export interface ResolvedCode {
  /** بخشی از متن که عدد کد بود (برای جایگزینی) */
  span: string;
  /** کدهای نزدیک، نزدیک‌ترین اول -- یکی یعنی مطمئن، بیشتر یعنی کاربر باید انتخاب کنه */
  options: CodeCandidate[];
}

// حداکثر فاصله‌ی پذیرفتنی؛ اگه گزینه‌ی بعدی حداقل MIN_MARGIN دورتر باشه، جواب یکتاست.
const MAX_DISTANCE = 1.5;
const MIN_MARGIN = 1;
const MAX_OPTIONS = 3;

/**
 * کدهای کاربر که به یکی از عددهای متن نزدیکن. اگه یک گزینه به‌وضوح نزدیک‌تر باشه فقط همون،
 * وگرنه تا سه گزینه‌ی نزدیک (برای انتخاب با دکمه)؛ اگه هیچ‌کدوم نزدیک نباشه null.
 */
export function matchSpokenCode(text: string, candidates: CodeCandidate[]): ResolvedCode | null {
  if (candidates.length === 0) return null;

  let best: { span: string; scored: { candidate: CodeCandidate; distance: number }[] } | null = null;
  for (const number of spokenNumbers(text)) {
    const scored = candidates
      .map((candidate) => {
        const digits = candidate.code.replace(/\D/g, '');
        const distance = digits
          ? Math.min(...number.readings.map((reading) => digitDistance(reading, digits)))
          : Infinity;
        return { candidate, distance };
      })
      .filter((item) => item.distance <= MAX_DISTANCE)
      .sort((a, b) => a.distance - b.distance);
    if (scored.length && (!best || scored[0].distance < best.scored[0].distance)) best = { span: number.span, scored };
  }
  if (!best) return null;

  const [first, second] = best.scored;
  if (!second || second.distance - first.distance >= MIN_MARGIN) return { span: best.span, options: [first.candidate] };
  return {
    span: best.span,
    options: best.scored.filter((item) => item.distance - first.distance < MIN_MARGIN).slice(0, MAX_OPTIONS).map((item) => item.candidate),
  };
}

/** «تی آر بی»، «کی عربی» و ... که whisper به جای TRB می‌نویسه -- با خود کد جایگزین می‌شن. */
const SPOKEN_PREFIX = /(?:TRB|T\s*R\s*B|تی[\s،,‌]*آر[\s،,‌]*بی|کی[\s‌]*عربی|تی[\s‌]*عربی|تی[\s‌]*آربی)[\s،,-]*$/iu;

/** متن رو با کد دقیق بازنویسی می‌کنه: «کی عربی ده هزار نه رو اعلام کن» ← «TRB100009 رو اعلام کن». */
export function applyResolvedCode(text: string, span: string, code: string): string | null {
  // span از متنِ تمیزشده (ارقام لاتین، بدون علائم) ساخته شده -- همون تمیزکاری روی متن اصلی.
  const latin = toLatinDigits(text).replace(/[.،,؟!:؛]/g, ' ').replace(/(\d+)/g, ' $1 ').replace(/\s+/g, ' ');
  const index = latin.indexOf(span);
  if (index < 0) return null;
  const before = latin.slice(0, index).replace(SPOKEN_PREFIX, '');
  const after = latin.slice(index + span.length);
  return `${before} ${code} ${after}`.replace(/\s+/g, ' ').trim();
}
