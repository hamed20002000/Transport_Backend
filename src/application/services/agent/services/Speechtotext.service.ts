import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROMPT_PATH = join(process.cwd(), 'src/application/services/agent/localFiles/whisper_prompt.txt');
const CORRECTIONS_PATH = join(process.cwd(), 'src/application/services/agent/localFiles/stt_corrections.json');

export interface TranscriptCorrection {
  from: RegExp;
  to: string;
}

// برش فرکانس‌های خیلی پایین/بالا (لرزش میکروفون، نویز) و یکسان کردن بلندی صدا؛
// ویس‌های پیام‌رسان معمولاً یا خیلی آرام‌اند یا clip شده‌اند.
const AUDIO_FILTER = 'highpass=f=80,lowpass=f=7600,loudnorm';

export interface WhisperOptions {
  /** نام فایل داخل models/ یا مسیر کامل */
  model: string;
  /** واژه‌های حوزه‌ی کار که whisper باید انتظارشان را داشته باشد؛ خالی یعنی بدون prompt */
  prompt: string;
  language: string;
}

/**
 * whisper.cpp روی سکوت و صدای خیلی کوتاه متن ساختگی می‌سازد («از از از از»،
 * «زیرنویس …»). چنین خروجی‌ای یعنی چیزی تشخیص داده نشد، نه یک دستور.
 */
export function cleanTranscript(raw: string, prompt = '', language = 'fa'): string {
  const text = raw
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // [BLANK_AUDIO]، (موسیقی)
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (/زیرنویس|amara|subtitle/i.test(text)) return '';
  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  // گفتار فارسی که نه حرف فارسی دارد نه عدد («PYM JBZ») حدس مدل روی صدای نامفهوم است
  if (language === 'fa' && !/[\u0600-\u06FF\p{N}]/u.test(text)) return '';
  // روی سکوت گاهی خودِ prompt برگردانده می‌شود
  if (text.length >= 15 && prompt.includes(text.replace(/[.،,]+$/, ''))) return '';

  const words = text.split(' ');
  if (words.length >= 3 && new Set(words).size === 1) return '';
  return text;
}

/** اشتباه‌های تکراریِ شناخته‌شده‌ی whisper در همین حوزه (فهرست در stt_corrections.json). */
export function applyCorrections(text: string, corrections: TranscriptCorrection[]): string {
  return corrections.reduce((current, rule) => current.replace(rule.from, rule.to), text);
}

export function loadCorrections(path = CORRECTIONS_PATH): TranscriptCorrection[] {
  try {
    const rules = JSON.parse(readFileSync(path, 'utf8')) as { from: string; to: string }[];
    return rules.map((rule) => ({ from: new RegExp(rule.from, 'gu'), to: rule.to }));
  } catch {
    return [];
  }
}

@Injectable()
export class SpeechToTextService {
  private readonly logger = new Logger(SpeechToTextService.name);

  private readonly whisperCppDir = process.env.WHISPER_CPP_DIR || '/home/hamed/whisper.cpp';
  private readonly whisperBinaryPath = join(this.whisperCppDir, 'build', 'bin', 'whisper-cli');
  private readonly defaults: WhisperOptions = {
    model: this.defaultModel(),
    prompt: this.defaultPrompt(),
    // زبان گفتار کاربرها؛ تشخیص خودکار whisper برای جمله‌های کوتاه فارسی قابل اعتماد نیست
    language: /^[a-z]{2}$/.test(process.env.WHISPER_LANGUAGE ?? '') ? process.env.WHISPER_LANGUAGE! : 'fa',
  };
  // اختیاری: مدل VAD (silero) تا سکوت‌ها قبل از whisper حذف شوند
  private readonly vadModel = process.env.WHISPER_VAD_MODEL && existsSync(this.modelPath(process.env.WHISPER_VAD_MODEL))
    ? this.modelPath(process.env.WHISPER_VAD_MODEL)
    : null;
  private readonly corrections = loadCorrections();
  // اختیاری: هر ویس (بعد از فیلتر) و متن تشخیص‌داده‌شده اینجا می‌ماند تا نمونه‌ی eval شود
  private readonly sampleDir = process.env.STT_SAMPLE_DIR || null;

  async transcribeFile(audioFilePath: string, overrides: Partial<WhisperOptions> = {}): Promise<string> {
    const options = { ...this.defaults, ...overrides };
    // همیشه یک فایل جدا (حتی اگر ورودی WAV باشد) تا فیلتر صدا اعمال شود و ورودی/خروجی ffmpeg یکی نشود
    const wavPath = audioFilePath.replace(/\.[^/.]+$/, '') + '-converted.wav';

    try {
      await execFileAsync('ffmpeg', ['-y', '-i', audioFilePath, '-af', AUDIO_FILTER, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);

      const args = ['-m', this.modelPath(options.model), '-f', wavPath, '-l', options.language, '-t', String(cpus().length), '--no-timestamps'];
      if (options.prompt) args.push('--prompt', options.prompt);
      if (this.vadModel) args.push('--vad', '-vm', this.vadModel);

      const { stdout } = await execFileAsync(this.whisperBinaryPath, args, { maxBuffer: 1024 * 1024 * 10 });
      this.logger.debug(`whisper (${options.model}) raw: "${stdout.trim()}"`);
      const text = applyCorrections(cleanTranscript(stdout, options.prompt, options.language), this.corrections);
      if (this.sampleDir) await this.keepSample(wavPath, stdout.trim(), text);
      return text;
    } finally {
      await unlink(wavPath).catch(() => undefined);
    }
  }

  /** فایل X.got.txt را با متن درستِ گفته‌شده به X.txt تغییر نام دهید تا agent:eval-stt آن را بسنجد. */
  private async keepSample(wavPath: string, raw: string, text: string): Promise<void> {
    try {
      await mkdir(this.sampleDir!, { recursive: true });
      const name = join(this.sampleDir!, new Date().toISOString().replace(/[:.]/g, '-'));
      await copyFile(wavPath, `${name}.wav`);
      await writeFile(`${name}.got.txt`, `raw: ${raw}\nfinal: ${text}\n`);
    } catch (error) {
      this.logger.warn(`Could not keep STT sample: ${(error as Error).message}`);
    }
  }

  private modelPath(model: string): string {
    return isAbsolute(model) ? model : join(this.whisperCppDir, 'models', model);
  }

  // large-v3 برای فارسی به‌مراتب بهتر از medium است؛ اگر دانلود نشده medium
  private defaultModel(): string {
    if (process.env.WHISPER_MODEL) return process.env.WHISPER_MODEL;
    return existsSync(this.modelPath('ggml-large-v3-q5_0.bin')) ? 'ggml-large-v3-q5_0.bin' : 'ggml-medium.bin';
  }

  // متن prompt در فایل است تا واژه‌ها بدون تغییر کد عوض شوند؛ WHISPER_PROMPT=off یعنی بدون prompt
  private defaultPrompt(): string {
    const fromEnv = process.env.WHISPER_PROMPT;
    if (fromEnv !== undefined) return fromEnv === 'off' ? '' : fromEnv;
    try {
      return readFileSync(PROMPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }
}
