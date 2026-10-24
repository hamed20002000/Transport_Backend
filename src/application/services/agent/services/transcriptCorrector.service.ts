import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { llmJson } from 'src/services/common/llmClient';

const PROMPT_PATH = join(process.cwd(), 'src/application/services/agent/prompts/transcript_correction.prompt');
const VOCABULARY_PATH = join(process.cwd(), 'src/application/services/agent/localFiles/whisper_prompt.txt');
// کاربر منتظر دیدن متن ویس است؛ اگر مدل کند بود همان متن whisper می‌ماند
const TIMEOUT_MS = 4000;
// هم‌آوا یعنی یک حرف فرق در کلمه‌ی کوتاه («کار» → «بار»، «تیران» → «تهران») و
// حداکثر دو حرف در کلمه‌ی بلند («تیلیگرام» → «تلگرام»)؛ تغییر بزرگ‌تر معمولاً حدس
// مدل است («برگان» → «برگردان») و در eval روی ویس‌های واقعی متن را بدتر می‌کرد.
const allowedChange = (length: number) => (length <= 5 ? 1 : 2);

const letters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');

function editDistance(a: string, b: string): number {
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

/** بخش‌های متفاوت دو دنباله‌ی کلمه (هم‌ترازی LCS)؛ هر بخش کلمه‌های پیوسته‌ی عوض‌شده‌ی دو طرف است. */
function changedChunks(a: string[], b: string[]): { from: string[]; to: string[] }[] {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const chunks: { from: string[]; to: string[] }[] = [];
  let current: { from: string[]; to: string[] } | null = null;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      current = null;
      i++;
      j++;
      continue;
    }
    current ??= chunks[chunks.push({ from: [], to: [] }) - 1];
    if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) current.from.push(a[i++]);
    else current.to.push(b[j++]);
  }
  return chunks;
}

/**
 * پیشنهاد مدل فقط وقتی پذیرفته می‌شود که هر تغییرش جایگزینی یک کلمه با کلمه‌ی
 * هم‌آوا باشد؛ وگرنه همان متن whisper می‌ماند. رد می‌شود: کلمه‌ی اضافه/حذف‌شده،
 * تغییر هر چیزی که رقم یا حرف لاتین دارد (کد بار و پلاک را voiceCodes حل می‌کند)،
 * برعکس شدن نفی («نکن» ↔ «کن»)، جایگزینی با کلمه‌ای که ظاهرش خیلی فرق دارد، و عوض شدن
 * کلمه‌ای که خودش از واژه‌های برنامه است (known؛ «سفرهای» → «بارهای» عملیات را عوض می‌کند).
 */
export function acceptCorrection(heard: string, suggested: string | null | undefined, known: ReadonlySet<string> = new Set()): string {
  const proposal = suggested?.replace(/\s+/g, ' ').trim();
  if (!proposal) return heard;
  const words = (text: string) => text.split(' ').map(letters).filter(Boolean);
  const chunks = changedChunks(words(heard), words(proposal));
  for (const { from, to } of chunks) {
    if (!from.length || !to.length) return heard;
    const a = from.join('');
    const b = to.join('');
    if (/[0-9۰-۹٠-٩A-Za-z]/.test(a + b)) return heard;
    if (from.some((word) => known.has(word))) return heard;
    if (from.some((word) => to.includes(`ن${word}`)) || to.some((word) => from.includes(`ن${word}`))) return heard;
    if (editDistance(a, b) > allowedChange(Math.min(a.length, b.length))) return heard;
  }
  return chunks.length ? proposal : heard;
}

/**
 * اصلاح کلمه‌های اشتباه‌شنیده‌ی ویس با مدل محلی (مثل «کار تهران تبریز» → «بار …»)،
 * پیش از نشان دادن متن به کاربر و اجرای agent؛ متنی که کاربر می‌بیند همان است که اجرا می‌شود.
 * هر خطا یا کندی مدل یعنی همان متن whisper.
 */
@Injectable()
export class TranscriptCorrectorService {
  private readonly logger = new Logger(TranscriptCorrectorService.name);
  private readonly vocabulary = (() => {
    try {
      return readFileSync(VOCABULARY_PATH, 'utf8').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  })();
  // کلمه‌های فهرست whisper درست‌اند و هیچ‌وقت «اصلاح» نمی‌شوند
  private readonly known = new Set(this.vocabulary.split(' ').map(letters).filter(Boolean));
  private readonly systemPrompt = (() => {
    try {
      return this.vocabulary ? readFileSync(PROMPT_PATH, 'utf8').replace('{{VOCABULARY}}', this.vocabulary) : null;
    } catch {
      return null;
    }
  })();

  async correct(heard: string): Promise<string> {
    if (!this.systemPrompt || !heard.trim()) return heard;
    try {
      const { text: suggested } = await llmJson<{ text?: string }>({
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: heard },
        ],
        think: false,
        options: { temperature: 0 },
        format: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        timeoutMs: TIMEOUT_MS,
      });
      const text = acceptCorrection(heard, suggested, this.known);
      if (text !== heard) this.logger.debug(`voice transcript corrected: "${heard}" → "${text}"`);
      else if (suggested && suggested.trim() !== heard.trim()) this.logger.debug(`voice correction rejected: "${heard}" → "${suggested}"`);
      return text;
    } catch (error) {
      this.logger.warn(`Transcript correction skipped: ${(error as Error).message}`);
      return heard;
    }
  }
}
