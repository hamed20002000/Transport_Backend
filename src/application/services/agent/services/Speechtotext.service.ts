import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { cpus } from 'node:os';

const execAsync = promisify(exec);

@Injectable()
export class SpeechToTextService {
    private readonly logger = new Logger(SpeechToTextService.name);

    private readonly whisperCppDir = process.env.WHISPER_CPP_DIR || '/home/hamed/whisper.cpp';
    private readonly whisperBinaryPath = join(this.whisperCppDir, 'build', 'bin', 'whisper-cli');
    private readonly modelPath = join(this.whisperCppDir, 'models', 'ggml-medium.bin');

    private getThreadCount(): number {
        return cpus().length;
    }

    async transcribeFile(audioFilePath: string): Promise<string> {
        let wavPath = audioFilePath;

        // اگه فایل از قبل WAV نیست (مثلاً webm/m4a از کلاینت وب)، تبدیلش کن.
        // اگه از قبل WAV بود (مثلاً از TelegramService که خودش قبلاً تبدیل
        // کرده)، این مرحله رو کامل رد کن -- وگرنه ورودی/خروجی ffmpeg یکی
        // می‌شن و خطای "cannot edit existing files in-place" می‌گیریم.
        if (!audioFilePath.toLowerCase().endsWith('.wav')) {
            // به‌جای صرفاً جایگزینی پسوند، یک پسوند مجزا اضافه می‌کنیم تا
            // هیچ‌وقت با ورودی برخورد نکنه (حتی اگه فرمت‌های عجیب دیگه‌ای
            // هم بیان)
            const convertedPath = audioFilePath.replace(/\.[^/.]+$/, '') + '-converted.wav';

            const convertCommand = `ffmpeg -y -i "${audioFilePath}" -ar 16000 -ac 1 -c:a pcm_s16le "${convertedPath}"`;
            this.logger.debug(`تبدیل فرمت: ${convertCommand}`);

            try {
                const { stderr: convertStderr } = await execAsync(convertCommand);
                if (convertStderr) {
                    this.logger.debug(`ffmpeg stderr: ${convertStderr}`);
                }
            } catch (error: any) {
                this.logger.error(`خطای تبدیل فرمت با ffmpeg: ${error.message}`);
                throw error;
            }

            wavPath = convertedPath;
        } else {
            this.logger.debug(`فایل از قبل WAV هست، تبدیل رد شد: ${audioFilePath}`);
        }

        // قدم ۲: حالا whisper-cli رو روی فایل WAV اجرا کن
        const threads = this.getThreadCount();
        const transcribeCommand = `${this.whisperBinaryPath} -m ${this.modelPath} -f "${wavPath}" -l tr -t ${threads} --no-timestamps`;
        this.logger.debug(`دستور تبدیل صدا به متن: ${transcribeCommand}`);

        const { stdout, stderr } = await execAsync(transcribeCommand, {
            maxBuffer: 1024 * 1024 * 10,
        });

        if (stderr) {
            this.logger.debug(`whisper-cli stderr: ${stderr}`);
        }

        this.logger.debug(`خروجی خام: "${stdout}"`);

        return stdout.trim();
    }
}