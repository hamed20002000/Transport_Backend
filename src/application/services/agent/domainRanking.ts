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

export const EMBEDDING_URL = 'http://localhost:11434/api/embed';
export const EMBEDDING_MODEL = 'bge-m3:latest';

const SHORT_STEM_LENGTH_THRESHOLD = 3;
// استم‌های کوتاه فقط 15% از idf واقعی‌شان را نگه می‌دارند
const SHORT_STEM_DISCOUNT_FACTOR = 0.15;

// اگر بهترین شباهت dense از این بیشتر باشد، حتی بدون کمک lexical به آن اعتماد می‌کنیم
export const DENSE_CONFIDENCE_THRESHOLD = 0.5;

export const DOMAIN_SEARCH_LIMIT = 8;
export const DOMAIN_FINAL_LIMIT = 2;

export interface DomainLexicalIndex {
  idf: Map<string, number>;
  /** domain -> (lexeme -> تعداد تکرار) */
  termFreq: Map<string, Map<string, number>>;
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
  const ndoc = new Map<string, number>();
  for (const domain of visible) {
    for (const lexeme of domain.termFreq.keys()) ndoc.set(lexeme, (ndoc.get(lexeme) ?? 0) + 1);
  }
  return {
    termFreq: new Map(visible.map((d) => [d.name, d.termFreq])),
    idf: buildIdf(
      [...ndoc.entries()].map(([word, n]) => ({ word, ndoc: n })),
      visible.length,
    ),
  };
}

/** امتیاز TF-IDF هر domain برای lexemeهای متن کاربر، نزولی. */
export function scoreLexical(index: DomainLexicalIndex, queryLexemes: string[], limit: number): ScoredDomain[] {
  if (queryLexemes.length === 0) return [];

  const domainScores: ScoredDomain[] = [];
  for (const [domainName, termFreqMap] of index.termFreq.entries()) {
    let score = 0;
    for (const lexeme of queryLexemes) {
      const tf = termFreqMap.get(lexeme);
      if (tf === undefined) continue;
      score += tf * (index.idf.get(lexeme) ?? 0);
    }
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

/** dense باید نزولی و به شکل شباهت (1 - فاصله‌ی کسینوسی) باشد. */
export function rankDomains(dense: ScoredDomain[], lexical: ScoredDomain[]): DomainRanking {
  const strongLexical = filterWeakLexicalMatches(lexical).map((item) => item.name);
  const ranked = reciprocalRankFusion(
    dense.map((d) => d.name),
    strongLexical,
  );
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
