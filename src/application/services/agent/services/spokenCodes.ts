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
