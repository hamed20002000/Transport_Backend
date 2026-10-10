import { Injectable, Logger } from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ffmpeg روی سرور نسخه‌ی snap است و به /tmp دسترسی ندارد؛ فایل‌های موقت داخل پروژه
const WORK_DIR = join(process.cwd(), 'uploads', 'tts');
// متن خیلی بلند یعنی صدای چنددقیقه‌ای که راننده گوش نمی‌دهد؛ جلوی مصرف بی‌جا را هم می‌گیرد
const MAX_TEXT_LENGTH = 3000;

export type SpeechFormat = 'ogg' | 'mp3';

/**
 * متن فارسی به صدا با Piper (آفلاین، روی همین سرور؛ مثل whisper.cpp برای صدا به متن).
 * خروجی ogg/opus برای پیام صوتی پیام‌رسان‌ها و mp3 برای پخش در مرورگر.
 *   PIPER_DIR   پوشه‌ی Piper (پیش‌فرض /home/hamed/piper)
 *   PIPER_VOICE مدل صدا، نام فایل در PIPER_DIR/models یا مسیر کامل (پیش‌فرض fa_IR-amir-medium.onnx)
 * اگر Piper نصب نباشد available=false و صدا ساخته نمی‌شود (جواب متنی کار می‌کند).
 */
@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);
  private readonly piperDir = process.env.PIPER_DIR || '/home/hamed/piper';
  private readonly binary = join(this.piperDir, 'piper');
  private readonly voice = (() => {
    const voice = process.env.PIPER_VOICE || 'fa_IR-amir-medium.onnx';
    return isAbsolute(voice) ? voice : join(this.piperDir, 'models', voice);
  })();

  get available(): boolean {
    return existsSync(this.binary) && existsSync(this.voice);
  }

  async synthesize(text: string, format: SpeechFormat = 'ogg'): Promise<Buffer> {
    if (!this.available) throw new Error('Piper is not installed');
    const input = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
    if (!input) throw new Error('Nothing to say');

    mkdirSync(WORK_DIR, { recursive: true });
    const id = randomUUID();
    const wav = join(WORK_DIR, `${id}.wav`);
    const out = join(WORK_DIR, `${id}.${format}`);
    try {
      await this.runPiper(input, wav);
      const codec = format === 'ogg' ? ['-c:a', 'libopus', '-b:a', '32k'] : ['-c:a', 'libmp3lame', '-b:a', '64k'];
      await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', ...codec, out]);
      return await readFile(out);
    } finally {
      await Promise.all([rm(wav, { force: true }), rm(out, { force: true })]);
    }
  }

  /** متن از stdin (نه آرگومان) تا هر نویسه‌ای در نام جایگاه‌ها و ... مشکلی نسازد. */
  private runPiper(text: string, wav: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, ['--model', this.voice, '--output_file', wav], { cwd: this.piperDir });
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          this.logger.warn(`piper exited ${code}: ${stderr.slice(-300)}`);
          reject(new Error(`piper exited with ${code}`));
        }
      });
      child.stdin.end(text);
    });
  }
}
