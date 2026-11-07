/**
 * منطق خالص انتخاب domain (بدون دیتابیس و شبکه). هم CondinateService در زمان
 * اجرا و هم اسکریپت ارزیابی توضیح domainها (npm run agent:eval-domains) از همین
 * فایل استفاده می‌کنند تا نتیجه‌ی ارزیابی دقیقاً همان رفتار واقعی باشد.
 */

export type ScoredDomain = { name: string; score: number };

/**
 * پیکربندی full-text برای domainها. ستون تولیدی "SearchVector" در جدول
 * "ToolDomain" هم با 'simple' ساخته شده؛ متن کاربر باید با همان پیکربندی
 * شکسته شود وگرنه کلمه‌ها با هم تطبیق نمی‌خورند. Postgres stemmer فارسی
 * ندارد و 'simple' کلمه‌ها را کامل و فقط با حروف کوچک نگه می‌دارد.
 */
export const DOMAIN_TEXT_SEARCH_CONFIG = 'simple';

const SHORT_STEM_LENGTH_THRESHOLD = 3;
// استم‌های کوتاه فقط 15% از idf واقعی‌شان را نگه می‌دارند
const SHORT_STEM_DISCOUNT_FACTOR = 0.15;

// اگر بهترین شباهت dense از این بیشتر باشد، حتی بدون کمک lexical به آن اعتماد می‌کنیم
export const DENSE_CONFIDENCE_THRESHOLD = 0.5;

export const DOMAIN_SEARCH_LIMIT = 8;
export const DOMAIN_FINAL_LIMIT = 2;

/**
 * Persian has no stemmer in Postgres ('simple' keeps whole words), so «راننده»، «رانندگان»، «راننده‌ها» and
 * «رانندگانم» were four unrelated words: a request worded differently from a domain's text matched nothing of it, and
 * a common word («لیست») decided the domain. A light, conservative stemmer for both the domains' text and the user's:
 * the plural «ها» (and «های/هایی»، with a possessive after it), a possessive after a plural in «ان» («رانندگانم»،
 * «رانندگانمون»)، the plural «گان» → «ه» («رانندگان» → «راننده»)، and whatever suffix follows a half-space («راننده‌ای»). Endings that are often
 * part of the word itself (a lone «ی»: «داخلی»; «ان»: «تهران») are left. A bare suffix token («ها» of «راننده ها») is
 * dropped. Applied in buildLexicalIndex and scoreLexical, so the server and the evaluation stem alike.
 */
const PLURAL_SUFFIXES = ['هایمان', 'هایتان', 'هایشان', 'هامون', 'هاتون', 'هاشون', 'هایم', 'هایت', 'هایش', 'هایی', 'های', 'هام', 'هات', 'هاش', 'ها'];
const POSSESSIVE_AFTER_PLURAL = ['مون', 'تون', 'شون', 'مان', 'تان', 'شان', 'م', 'ت', 'ش'];
const BARE_SUFFIXES = new Set([...PLURAL_SUFFIXES, 'ای', 'ی']);
const MIN_STEM = 2;

// what follows a half-space («راننده‌ها»، «راننده‌ای»، «کانال‌هامون»): a suffix, the word is what comes before it
const HALF_SPACE_SUFFIXES = new Set([...PLURAL_SUFFIXES, 'ای', 'ی', 'ام', 'ات', 'اش', 'مان', 'تان', 'شان', 'مون', 'تون', 'شون']);

export function persianStem(lexeme: string): string {
  let word = lexeme.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  if (BARE_SUFFIXES.has(word)) return '';
  const halfSpace = word.lastIndexOf('\u200c');
  if (halfSpace > 0 && HALF_SPACE_SUFFIXES.has(word.slice(halfSpace + 1))) word = word.slice(0, halfSpace);
  word = word.replace(/\u200c/g, '');
  for (const suffix of PLURAL_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }
  for (const suffix of POSSESSIVE_AFTER_PLURAL) {
    const rest = word.slice(0, -suffix.length);
    if (word.endsWith(suffix) && rest.endsWith('ان') && rest.length >= MIN_STEM + 2) {
      word = rest;
      break;
    }
  }
  if (word.endsWith('گان') && word.length - 3 >= MIN_STEM) word = `${word.slice(0, -3)}ه`;
  return word;
}

/** A domain's word counts with the words stemmed (the counts of words with one stem added up). */
export function stemTermFreq(termFreq: Map<string, number>): Map<string, number> {
  const stemmed = new Map<string, number>();
  for (const [lexeme, count] of termFreq) {
    const stem = persianStem(lexeme);
    if (stem) stemmed.set(stem, (stemmed.get(stem) ?? 0) + count);
  }
  return stemmed;
}

export interface DomainLexicalIndex {
  idf: Map<string, number>;
  /** domain -> (lexeme -> تعداد تکرار) */
  termFreq: Map<string, Map<string, number>>;
  /** the same by stem (persianStem), for a word of the user's that no domain has as it is */
  stemIdf: Map<string, number>;
  stemFreq: Map<string, Map<string, number>>;
}

function idfOf(maps: Map<string, number>[]): Map<string, number> {
  const ndoc = new Map<string, number>();
  for (const map of maps) for (const lexeme of map.keys()) ndoc.set(lexeme, (ndoc.get(lexeme) ?? 0) + 1);
  return buildIdf([...ndoc.entries()].map(([word, n]) => ({ word, ndoc: n })), maps.length);
}

/**
 * به‌جای حذف کلمات خاص، به استم‌های کوتاه تخفیف خودکار می‌دهیم -- این قانون
 * بدون لیست دستی کلمات، روی هر مشکل مشابه در آینده هم اعمال می‌شود.
 */
export function buildIdf(stats: { word: string; ndoc: number }[], totalDomains: number): Map<string, number> {
  return new Map(
    stats.map((s) => {
      const baseIdf = Math.log(1 + totalDomains / s.ndoc);
      const isShortStem = s.word.length <= SHORT_STEM_LENGTH_THRESHOLD;
      return [s.word, isShortStem ? baseIdf * SHORT_STEM_DISCOUNT_FACTOR : baseIdf];
    }),
  );
}

export interface DomainEntry {
  name: string;
  /** نقش‌هایی که این domain برایشان است (COMPANY، DRIVER، BROKER، ...) */
  roles: string[];
  /** lexeme -> تعداد تکرار در توضیح domain */
  termFreq: Map<string, number>;
}

/**
 * domain فقط برای کاربری دیده می‌شود که دست‌کم یکی از نقش‌هایش را دارد.
 * این فقط برای دقت انتخاب است؛ دسترسی را خود ابزار هنگام اجرا بررسی می‌کند.
 */
export function isVisibleTo(domainRoles: string[], userRoles: string[]): boolean {
  return domainRoles.some((role) => userRoles.includes(role));
}

/**
 * index کلمه‌ای فقط از domainهای نقش کاربر ساخته می‌شود؛ idf هم فقط بین همین‌ها
 * حساب می‌شود. پس اضافه شدن domainهای یک نقش دیگر (مثلاً راننده) هیچ اثری روی
 * امتیاز domainهای شرکت ندارد.
 */
export function buildLexicalIndex(domains: DomainEntry[], userRoles: string[]): DomainLexicalIndex {
  const visible = domains.filter((d) => isVisibleTo(d.roles, userRoles));
  const stemmed = visible.map((d) => stemTermFreq(d.termFreq));
  return {
    termFreq: new Map(visible.map((d) => [d.name, d.termFreq])),
    idf: idfOf(visible.map((d) => d.termFreq)),
    stemFreq: new Map(visible.map((d, i) => [d.name, stemmed[i]])),
    stemIdf: idfOf(stemmed),
  };
}

/** امتیاز TF-IDF هر domain برای lexemeهای متن کاربر، نزولی. */
export function scoreLexical(index: DomainLexicalIndex, lexemes: string[], limit: number): ScoredDomain[] {
  const queryLexemes = lexemes;
  if (queryLexemes.length === 0) return [];
  // a word some domain has as it is counts as before; one none has («رانندگانم»، «راننده‌هام») by its stem
  const known = (lexeme: string) => [...index.termFreq.values()].some((map) => map.has(lexeme));
  const exact = queryLexemes.filter(known);
  const byStem = [...new Set(queryLexemes.filter((lexeme) => !known(lexeme)).map(persianStem).filter(Boolean))];

  const domainScores: ScoredDomain[] = [];
  for (const [domainName, termFreqMap] of index.termFreq.entries()) {
    let score = 0;
    for (const lexeme of exact) score += (termFreqMap.get(lexeme) ?? 0) * (index.idf.get(lexeme) ?? 0);
    const stemMap = index.stemFreq.get(domainName);
    for (const stem of byStem) score += (stemMap?.get(stem) ?? 0) * (index.stemIdf.get(stem) ?? 0);
    if (score > 0) domainScores.push({ name: domainName, score });
  }

  return domainScores.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * RRF فقط به رتبه نگاه می‌کند نه مقدار امتیاز؛ پس match‌های خیلی ضعیف lexical
 * باید قبلش حذف شوند. آستانه نسبی است چون scale امتیاز TF-IDF به طول prompt
 * بستگی دارد.
 */
export function filterWeakLexicalMatches(scored: ScoredDomain[], relativeThreshold = 0.25): ScoredDomain[] {
  if (scored.length === 0) return [];
  const topScore = scored[0].score;
  if (topScore === 0) return [];
  return scored.filter((s) => s.score / topScore >= relativeThreshold);
}

export function reciprocalRankFusion(listA: string[], listB: string[], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const list of [listA, listB]) {
    list.forEach((name, index) => scores.set(name, (scores.get(name) ?? 0) + 1 / (k + index + 1)));
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

export interface DomainRanking {
  /** domainها به ترتیب نهایی (قبل از برش به finalLimit) */
  ranked: string[];
  /** lexical چیزی پیدا نکرد و dense هم مطمئن نیست -- باید از domain ابزار قبلی کمک گرفت */
  ambiguous: boolean;
}

/**
 * The meaning's clear winner (its similarity this far above the next domain's) stays among the domains chosen
 * (DOMAIN_FINAL_LIMIT): RRF adds the two lists' ranks, so a domain first by meaning but missing from the words (a common
 * word, «لیست», pointing at the cargo domains) fell behind two domains that were merely in both lists — «لیست
 * راننده‌ها» went to the cargo tools with the drivers' domain clearly first by meaning.
 */
export const DENSE_CLEAR_MARGIN = Number(process.env.AGENT_DENSE_CLEAR_MARGIN ?? 0.08);

/** dense باید نزولی و به شکل شباهت (1 - فاصله‌ی کسینوسی) باشد. */
export function rankDomains(dense: ScoredDomain[], lexical: ScoredDomain[]): DomainRanking {
  const strongLexical = filterWeakLexicalMatches(lexical).map((item) => item.name);
  const ranked = reciprocalRankFusion(
    dense.map((d) => d.name),
    strongLexical,
  );
  const clearWinner = dense.length > 1 && dense[0].score - dense[1].score >= DENSE_CLEAR_MARGIN ? dense[0].name : null;
  if (clearWinner && ranked.indexOf(clearWinner) >= DOMAIN_FINAL_LIMIT) {
    ranked.splice(ranked.indexOf(clearWinner), 1);
    ranked.splice(DOMAIN_FINAL_LIMIT - 1, 0, clearWinner);
  }
  const denseIsConfident = dense.length > 0 && dense[0].score >= DENSE_CONFIDENCE_THRESHOLD;
  return { ranked, ambiguous: strongLexical.length === 0 && !denseIsConfident };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
