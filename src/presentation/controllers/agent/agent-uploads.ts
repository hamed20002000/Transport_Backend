import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const baseMimeType = (mimetype: string) => mimetype.split(';')[0].trim().toLowerCase();

/**
 * نام فایل روی دیسک همیشه UUID + پسوندی است که از روی mimetype انتخاب
 * می‌شود، نه نام فایل کاربر؛ مسیر فایل صوتی داخل دستور ffmpeg/whisper
 * (shell) می‌رود و مسیر پیوست به ابزارهای agent داده می‌شود.
 */
function uploadOptions(
  directory: (req: { user?: { userId?: string } }) => string,
  extensions: Record<string, string>,
  unsupportedMessage: string,
): MulterOptions {
  return {
    storage: diskStorage({
      destination: (req, _file, cb) => {
        const dir = directory(req as { user?: { userId?: string } });
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        cb(null, `${randomUUID()}.${extensions[baseMimeType(file.mimetype)]}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (!extensions[baseMimeType(file.mimetype)]) {
        cb(new BadRequestException(unsupportedMessage), false);
        return;
      }
      cb(null, true);
    },
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  };
}

//#region Voice ------------------------------------------------------------
export const VOICE_DIR = join(process.cwd(), 'uploads', 'agent-voice');

const VOICE_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

export const voiceUploadOptions = uploadOptions(() => VOICE_DIR, VOICE_EXTENSIONS, 'Unsupported audio format.');

export const VOICE_UPLOAD_DESCRIPTION = 'webm, ogg, mp3, m4a, aac or wav; max 10 MB';

/** فایل صوتی و نسخه -converted.wav که SpeechToTextService کنارش می‌سازد. */
export async function removeVoiceFiles(path: string): Promise<void> {
  const converted = path.replace(/\.[^/.]+$/, '') + '-converted.wav';
  await Promise.all([path, converted].map((p) => unlink(p).catch(() => undefined)));
}
//#endregion

//#region Attachments ------------------------------------------------------
export const ATTACHMENT_DIR = join(process.cwd(), 'uploads', 'agent-files');

const ATTACHMENT_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const ATTACHMENT_UPLOAD_DESCRIPTION = 'pdf, xlsx, xls, jpg, png or webp; max 10 MB';

// هر کاربر پوشه خودش را دارد؛ فایل کاربر دیگر با fileId قابل دسترسی نیست.
const userAttachmentDir = (userId: string) => join(ATTACHMENT_DIR, userId);

export const attachmentUploadOptions = uploadOptions(
  (req) => {
    if (!req.user?.userId) throw new BadRequestException('Unauthenticated upload.');
    return userAttachmentDir(req.user.userId);
  },
  ATTACHMENT_EXTENSIONS,
  'Only PDF, Excel and image files are allowed.',
);

/** fileId همان نام فایل ذخیره‌شده است؛ این الگو هر مسیر نسبی (../) را رد می‌کند. */
export const ATTACHMENT_ID_PATTERN = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${[...new Set(Object.values(ATTACHMENT_EXTENSIONS))].join('|')})$`,
);

/** fileIdها را به مسیر فایل‌های همین کاربر تبدیل می‌کند؛ فایل ناموجود خطا است. */
export function resolveAttachments(userId: string, fileIds: string[] = []): string[] {
  return fileIds.map((fileId) => {
    const path = join(userAttachmentDir(userId), fileId);
    if (!ATTACHMENT_ID_PATTERN.test(fileId) || !existsSync(path)) {
      throw new BadRequestException(`Unknown file: ${fileId}`);
    }
    return path;
  });
}
//#endregion
