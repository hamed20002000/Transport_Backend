import {
  buildLexicalIndex,
  cosineSimilarity,
  DOMAIN_FINAL_LIMIT,
  DOMAIN_SEARCH_LIMIT,
  DomainEntry,
  DomainLexicalIndex,
  isVisibleTo,
  rankDomains,
  ScoredDomain,
  scoreLexical,
} from '../domainRanking';

export interface DomainDoc {
  domain_name: string;
  /** نقش‌هایی که domain برایشان است؛ همان فیلد domain_embedding_docs.json */
  roles: string[];
  embedding_text: string;
}

export interface EvalPrompt {
  text: string;
  /** domain درست برای این جمله */
  expect: string;
  /** نقش کسی که این جمله را می‌گوید (COMPANY، DRIVER، ...) */
  role: string;
}

export interface EvalDeps {
  /** embedding چند متن با همان مدلی که زمان اجرا استفاده می‌شود */
  embed(texts: string[]): Promise<number[][]>;
  /**
   * lexemeهای متن با همان پیکربندی full-text که "SearchVector" دارد؛ هر lexeme
   * به تعداد تکرارش در متن (تا tf توضیح domain درست شمرده شود).
   */
  lexemes(text: string): Promise<string[]>;
}

export interface PromptResult {
  prompt: EvalPrompt;
  selected: string[];
  correct: boolean;
  /** domain درست جزو domainهای انتخاب‌شده هست (شاید نه اول) */
  inSelection: boolean;
  /** شباهت dense به domain درست منهای شباهت به نزدیک‌ترین domain دیگرِ همان نقش */
  denseMargin: number;
  closestOther: string;
  /** رتبه‌ی domain درست فقط با فاصله‌ی embedding (۱ = نزدیک‌ترین) */
  denseRank: number;
  lexical: ScoredDomain[];
  ambiguous: boolean;
}

export interface EvalReport {
  results: PromptResult[];
  accuracy: number;
  /** "role: domain" برای جمله‌هایی که domain مورد انتظارشان برای آن نقش تعریف نشده */
  unknownDomains: string[];
}

/**
 * زیر این اختلاف، انتخاب درست شکننده است: dense عملاً مساوی است و فقط
 * کلمه‌های lexical تصمیم را گرفته‌اند.
 */
export const FRAGILE_DENSE_MARGIN = 0.03;

/**
 * هر جمله را دقیقاً مثل CondinateService.getCondinateDomainForRunPrompt
 * رتبه‌بندی می‌کند: فقط بین domainهای نقش گوینده، با idf همان نقش (بدون fallback
 * به domain ابزار قبلی، چون جمله‌ها تک‌پیامی‌اند).
 */
export async function evaluateDomains(docs: DomainDoc[], prompts: EvalPrompt[], deps: EvalDeps): Promise<EvalReport> {
  const invalid = docs.filter((d) => !Array.isArray(d.roles) || d.roles.length === 0).map((d) => d.domain_name);
  if (invalid.length) throw new Error(`Domains without roles: ${invalid.join(', ')}`);
  const withoutRole = prompts.filter((p) => !p.role).map((p) => p.text);
  if (withoutRole.length) throw new Error(`Prompts without role: ${withoutRole.join(' | ')}`);

  // همان چیزی که ستون تولیدی SearchVector برای هر domain می‌سازد
  const entries: DomainEntry[] = [];
  for (const doc of docs) {
    const termFreq = new Map<string, number>();
    for (const lexeme of await deps.lexemes(doc.embedding_text)) termFreq.set(lexeme, (termFreq.get(lexeme) ?? 0) + 1);
    entries.push({ name: doc.domain_name, roles: doc.roles, termFreq });
  }
  const indexes = new Map<string, DomainLexicalIndex>();
  const indexFor = (role: string) => {
    if (!indexes.has(role)) indexes.set(role, buildLexicalIndex(entries, [role]));
    return indexes.get(role)!;
  };

  const docVectors = await deps.embed(docs.map((d) => d.embedding_text));
  const promptVectors = await deps.embed(prompts.map((p) => p.text));

  const results: PromptResult[] = [];
  const unknown = new Set<string>();
  for (const [i, prompt] of prompts.entries()) {
    const similarities = docs
      .map((doc, j) => ({ doc, score: cosineSimilarity(promptVectors[i], docVectors[j]) }))
      .filter(({ doc }) => isVisibleTo(doc.roles, [prompt.role]))
      .map(({ doc, score }) => ({ name: doc.domain_name, score }))
      .sort((a, b) => b.score - a.score);
    if (!similarities.some((s) => s.name === prompt.expect)) unknown.add(`${prompt.role}: ${prompt.expect}`);

    const dense = similarities.slice(0, DOMAIN_SEARCH_LIMIT);
    // مثل CondinateService.extractLexemes: هر کلمه‌ی متن کاربر یک بار
    const queryLexemes = [...new Set(await deps.lexemes(prompt.text))];
    const lexical = scoreLexical(indexFor(prompt.role), queryLexemes, DOMAIN_SEARCH_LIMIT);
    const { ranked, ambiguous } = rankDomains(dense, lexical);
    const selected = ranked.slice(0, DOMAIN_FINAL_LIMIT);

    const expected = similarities.find((s) => s.name === prompt.expect);
    const closestOther = similarities.find((s) => s.name !== prompt.expect);

    results.push({
      prompt,
      selected,
      correct: selected[0] === prompt.expect,
      inSelection: selected.includes(prompt.expect),
      denseMargin: expected && closestOther ? expected.score - closestOther.score : Number.NaN,
      closestOther: closestOther?.name ?? '',
      denseRank: similarities.findIndex((s) => s.name === prompt.expect) + 1 || Number.NaN,
      lexical,
      ambiguous,
    });
  }

  return {
    results,
    accuracy: results.length ? results.filter((r) => r.correct).length / results.length : 0,
    unknownDomains: [...unknown],
  };
}

/** گزارش متنی برای ترمینال. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  for (const r of report.results) {
    const status = !r.correct ? 'FAIL' : r.denseMargin < FRAGILE_DENSE_MARGIN ? 'WEAK' : 'OK  ';
    const lexical =
      r.lexical
        .slice(0, 3)
        .map((l) => l.name)
        .join(',') || '-';
    lines.push(
      `${status} expect=${r.prompt.expect.padEnd(20)} got=[${r.selected.join(', ')}]` +
        ` embedRank=${r.denseRank} margin=${r.denseMargin.toFixed(3)} vs ${r.closestOther}  lexical=${lexical}` +
        `${r.ambiguous ? '  (ambiguous)' : ''}\n     ${r.prompt.text}`,
    );
  }

  const failed = report.results.filter((r) => !r.correct).length;
  const weak = report.results.filter((r) => r.correct && r.denseMargin < FRAGILE_DENSE_MARGIN).length;
  const inTop = report.results.filter((r) => r.inSelection).length;
  lines.push('');
  lines.push(
    `first choice correct : ${report.results.length - failed}/${report.results.length} (${(report.accuracy * 100).toFixed(1)}%)`,
  );
  lines.push(`in selected ${DOMAIN_FINAL_LIMIT}        : ${inTop}/${report.results.length}`);
  const denseFirst = report.results.filter((r) => r.denseRank === 1).length;
  const denseTop = report.results.filter((r) => r.denseRank <= DOMAIN_FINAL_LIMIT).length;
  lines.push(
    `embedding only       : first ${denseFirst}/${report.results.length}, in top ${DOMAIN_FINAL_LIMIT} ${denseTop}/${report.results.length}`,
  );
  lines.push(`WEAK (dense margin < ${FRAGILE_DENSE_MARGIN}; only the words decided it): ${weak}`);
  const roles = [...new Set(report.results.map((r) => r.prompt.role))];
  if (roles.length > 1) {
    for (const role of roles) {
      const ofRole = report.results.filter((r) => r.prompt.role === role);
      lines.push(`  ${role.padEnd(8)}: ${ofRole.filter((r) => r.correct).length}/${ofRole.length}`);
    }
  }
  if (report.unknownDomains.length) {
    lines.push(
      `WARNING: expected domains not defined for that role in the docs file: ${report.unknownDomains.join(', ')}`,
    );
  }
  return lines.join('\n');
}
