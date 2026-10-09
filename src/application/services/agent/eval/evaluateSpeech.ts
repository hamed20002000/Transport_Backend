/**
 * ارزیابی تبدیل صدا به متن با همان SpeechToTextService واقعی:
 *
 *   npm run agent:eval-stt
 *   npm run agent:eval-stt -- --models ggml-medium.bin,ggml-large-v3-q5_0.bin --prompt both
 *
 * نمونه‌ها: هر فایل صوتی در eval/stt-samples (ogg، webm، wav، m4a، mp3) با یک فایل
 * هم‌نام .txt که متن درستِ گفته‌شده در آن است. معیار CER است (درصد حروف اشتباه)؛
 * فاصله، نیم‌فاصله، علائم و فرق عدد فارسی/لاتین حساب نمی‌شود.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { config } from 'dotenv';

import { SpeechToTextService } from '../services/Speechtotext.service';

const SAMPLES_DIR = join(process.cwd(), 'src/application/services/agent/eval/stt-samples');
const AUDIO = new Set(['.ogg', '.oga', '.webm', '.wav', '.m4a', '.mp3']);

const norm = (text: string): string =>
  text
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[^\p{L}\p{N}]/gu, '');

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

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  config();
  const samples = existsSync(SAMPLES_DIR)
    ? readdirSync(SAMPLES_DIR)
        .filter((file) => AUDIO.has(extname(file).toLowerCase()))
        .map((file) => ({ audio: join(SAMPLES_DIR, file), expected: join(SAMPLES_DIR, `${basename(file, extname(file))}.txt`) }))
        .filter((sample) => existsSync(sample.expected))
    : [];
  if (!samples.length) {
    console.error(`No samples: put audio files with a same-name .txt transcript in ${SAMPLES_DIR}`);
    process.exitCode = 1;
    return;
  }

  const speech = new SpeechToTextService();
  const models = (arg('models') ?? '').split(',').filter(Boolean);
  const promptMode = arg('prompt') ?? 'default';
  const prompts: (string | undefined)[] = promptMode === 'both' ? [undefined, ''] : promptMode === 'off' ? [''] : [undefined];

  for (const model of models.length ? models : [undefined]) {
    for (const prompt of prompts) {
      const label = `${model ?? 'default model'} / ${prompt === '' ? 'no prompt' : 'prompt'}`;
      let errors = 0;
      let chars = 0;
      const started = Date.now();
      console.log(`\n=== ${label}`);
      for (const sample of samples) {
        const expected = readFileSync(sample.expected, 'utf8').trim();
        const overrides = { ...(model ? { model } : {}), ...(prompt === '' ? { prompt } : {}) };
        const got = await speech.transcribeFile(sample.audio, overrides);
        const distance = editDistance(norm(expected), norm(got));
        errors += distance;
        chars += norm(expected).length;
        const cer = norm(expected).length ? (100 * distance) / norm(expected).length : 0;
        console.log(`${cer.toFixed(0).padStart(4)}%  ${basename(sample.audio)}\n       expected: ${expected}\n       got     : ${got}`);
      }
      const seconds = (Date.now() - started) / 1000;
      console.log(`--- ${label}: CER ${((100 * errors) / Math.max(chars, 1)).toFixed(1)}%  (${seconds.toFixed(0)}s for ${samples.length} samples)`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
