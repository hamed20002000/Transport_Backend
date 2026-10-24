import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { Transcript, transcribeSpeech } from 'src/services/common/llmClient';
import { fixMisheardNumbers, numbersToDigits } from './spokenCodes';
import { fixMisheardPlaces } from './spokenPlaces';

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

// مکث‌های بیش از ۰.۷ ثانیه به ۰.۳۵ ثانیه: مدل‌های OpenAI سر مکث وسط جمله متن را تمام می‌کنند
// («لیست بارهای تهران ...» برای «لیست بارهای تهران [مکث] مرند رو بیار»). فقط برای تلاش دوم؛ روی
// همه‌ی ویس‌ها در eval دو ویس سالم را خراب کرد («ثبت کن» ← «ثبت شد»، «پمپ گازوئیل» ← «اون پگازویل»).
const SHORTEN_PAUSES = 'silenceremove=stop_periods=-1:stop_duration=0.7:stop_threshold=-45dB:stop_silence=0.35';

// OpenAI فایل اصلی را می‌گیرد (۴۸ کیلوهرتز پیام‌رسان‌ها، بدون فیلتر whisper)؛ فرمت‌های دیگر (مثلاً aac) همان WAV فیلترشده
const OPENAI_AUDIO_FORMATS = new Set(['.flac', '.m4a', '.mp3', '.mp4', '.mpeg', '.mpga', '.oga', '.ogg', '.wav', '.webm']);

/**
 * مدل بخشی از گفتار را نفهمیده: جای خالی («تهران ... رو بیار») یا گفتار فارسی که به زبان دیگری
 * رفته («Liste بارهاyı Tehranlara»). کدهای حروف بزرگ مثل TRB منحرف‌شدن حساب نمی‌شوند.
 */
export function isIncompleteTranscript(text: string, language = 'fa'): boolean {
  return /\.\.\.|…/.test(text) || (language === 'fa' && /[a-zçğıöşüə]/.test(text));
}

export interface WhisperOptions {
  /** نام فایل داخل models/ یا مسیر کامل */
  model: string;
  /** واژه‌های حوزه‌ی کار که whisper باید انتظارشان را داشته باشد؛ خالی یعنی بدون prompt */
  prompt: string;
  language: string;
  /** برای مقایسهٔ اثر VAD روی همان نمونه‌ها */
  vad: boolean;
  /** متنی که جلوی prompt می‌آید (مثلاً گزینه‌های منوی باز)؛ واژه‌های حوزه سر جایشان می‌مانند */
  promptPrefix?: string;
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
  // اجرای نصفِ دستور بدتر از دوباره پرسیدن است
  if (isIncompleteTranscript(text, language)) return '';
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
    vad: process.env.WHISPER_VAD !== 'off',
  };
  // اختیاری: مدل VAD (silero) تا سکوت‌ها قبل از whisper حذف شوند
  private readonly vadModelPath = process.env.WHISPER_VAD_MODEL
    ? this.modelPath(process.env.WHISPER_VAD_MODEL)
    : join(process.cwd(), 'uploads/stt-models/ggml-silero-v6.2.0.bin');
  private readonly vadModel = existsSync(this.vadModelPath)
    ? this.vadModelPath
    : null;
  private readonly corrections = loadCorrections();
  // اختیاری: هر ویس (بعد از فیلتر) و متن تشخیص‌داده‌شده اینجا می‌ماند تا نمونه‌ی eval شود
  private readonly sampleDir = process.env.STT_SAMPLE_DIR || null;

  get vadAvailable(): boolean {
    return this.vadModel !== null;
  }

  async transcribeFile(audioFilePath: string, overrides: Partial<WhisperOptions> = {}): Promise<string> {
    const merged = { ...this.defaults, ...overrides };
    const options = { ...merged, prompt: [merged.promptPrefix, merged.prompt].filter(Boolean).join(' ') };
    if (overrides.vad === true && !this.vadModel) {
      throw new Error('VAD model is missing. Download Silero or set WHISPER_VAD_MODEL.');
    }
    // همیشه یک فایل جدا (حتی اگر ورودی WAV باشد) تا فیلتر صدا اعمال شود و ورودی/خروجی ffmpeg یکی نشود
    const base = audioFilePath.replace(/\.[^/.]+$/, '');
    const wavPath = `${base}-converted.wav`;
    const shortenedWavPath = `${base}-shortened.wav`;
    const shortenedOriginalPath = `${base}-shortened-original.wav`;
    const sendsOriginal = OPENAI_AUDIO_FORMATS.has(extname(audioFilePath).toLowerCase());

    try {
      await execFileAsync('ffmpeg', ['-y', '-i', audioFilePath, '-af', AUDIO_FILTER, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath]);

      // اول OpenAI، اگر جواب نداد whisper.cpp (یا با LLM_LOCAL_FALLBACK=off، LlmUnavailableError)؛
      // مدل whisper صریح (ارزیابی مدل‌های محلی) مستقیم محلی است. پاک‌سازی و اصلاح‌های پایین برای هر دو یکسان است
      const transcribe = (openAiAudio: string, localWav: string) =>
        overrides.model
          ? this.runWhisper(localWav, options)
          : transcribeSpeech(openAiAudio, options, () => this.runWhisper(localWav, options));
      let heard = await transcribe(sendsOriginal ? audioFilePath : wavPath, wavPath);
      this.logger.debug(`${heard.model} raw: "${heard.text.trim()}"`);
      // متن ناقص: یک بار دیگر با مکث‌های کوتاه‌شده؛ اگر باز ناقص بود cleanTranscript ردش می‌کند (دوباره بگو)
      if (isIncompleteTranscript(heard.text, options.language)) {
        await execFileAsync('ffmpeg', ['-y', '-i', wavPath, '-af', SHORTEN_PAUSES, shortenedWavPath]);
        // آستانه‌ی سکوت (-45dB) برای صدای هم‌بلندشده است؛ نرخ نمونه‌برداری اصلی می‌ماند
        if (sendsOriginal) {
          await execFileAsync('ffmpeg', ['-y', '-i', audioFilePath, '-af', `loudnorm,${SHORTEN_PAUSES}`, '-ar', '48000', '-ac', '1', shortenedOriginalPath]);
        }
        heard = await transcribe(sendsOriginal ? shortenedOriginalPath : shortenedWavPath, shortenedWavPath);
        this.logger.debug(`${heard.model} raw (pauses shortened): "${heard.text.trim()}"`);
      }
      // fixed list of known mishearings, then number words and city names misheard by sound-alike letters
      // («تو هزار» ← «دو هزار»، «به علشتر» ← «به الشتر»)
      const corrected = applyCorrections(cleanTranscript(heard.text, options.prompt, options.language), this.corrections);
      // عدد به حروف («شصت تن») به رقم، مثل whisper محلی؛ OpenAI گاهی رقمی، گاهی به حروف می‌نویسد
      const text = numbersToDigits(fixMisheardPlaces(fixMisheardNumbers(corrected)));
      if (this.sampleDir) await this.keepSample(wavPath, heard.text.trim(), text, heard.model);
      return text;
    } finally {
      await unlink(wavPath).catch(() => undefined);
      await unlink(shortenedWavPath).catch(() => undefined);
      await unlink(shortenedOriginalPath).catch(() => undefined);
    }
  }

  private async runWhisper(wavPath: string, options: WhisperOptions): Promise<Transcript> {
    const args = ['-m', this.modelPath(options.model), '-f', wavPath, '-l', options.language, '-t', String(cpus().length), '--no-timestamps'];
    if (options.prompt) args.push('--prompt', options.prompt);
    if (options.vad && this.vadModel) args.push('--vad', '-vm', this.vadModel);

    const { stdout } = await execFileAsync(this.whisperBinaryPath, args, { maxBuffer: 1024 * 1024 * 10 });
    return { text: stdout, model: basename(options.model) };
  }

  /** متن درست را با npm run stt:label در X.txt بنویسید؛ model: مدلی که این متن را ساخت، برای مقایسه‌ی مدل‌ها. */
  private async keepSample(wavPath: string, raw: string, text: string, model: string): Promise<void> {
    try {
      await mkdir(this.sampleDir!, { recursive: true });
      const name = join(this.sampleDir!, new Date().toISOString().replace(/[:.]/g, '-'));
      await copyFile(wavPath, `${name}.wav`);
      await writeFile(`${name}.got.txt`, `raw: ${raw}\nfinal: ${text}\nmodel: ${model}\n`);
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
