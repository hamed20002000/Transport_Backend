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
        // قدم ۱: هر فرمتی که کلاینت فرستاده (webm, m4a, ...) رو به WAV
        // استاندارد (16kHz mono) تبدیل کن -- چون whisper.cpp با webm
        // ممکنه بدون خطا ولی با خروجی خالی اجرا بشه
        const wavPath = audioFilePath.replace(/\.[^/.]+$/, '.wav');

        const convertCommand = `ffmpeg -y -i "${audioFilePath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}"`;
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

        // قدم ۲: حالا whisper-cli رو روی فایل WAV تبدیل‌شده اجرا کن
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