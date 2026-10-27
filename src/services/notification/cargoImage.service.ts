import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

import { normalizePersianText } from 'src/domain/helper/persianText';

/** Photos companies and factories put on their loads (not public: served by CargoImageController). */
export const CARGO_PHOTO_DIR = join(process.cwd(), 'private-uploads', 'cargo-photos');
export const MAX_CARGO_PHOTO_BYTES = 8 * 1024 * 1024;
/** a stored photo's name: what CargoImageService.store gives back */
export const CARGO_PHOTO_NAME = /^[0-9a-f-]{36}\.jpg$/;

/** Where the photo of each kind of cargo is (one JPEG per CargoKind; sources in SOURCES.md). */
const KIND_PHOTO_DIR = join(__dirname, '..', '..', 'assets', 'cargo-kinds');

/**
 * How big a picture goes out: a small thumbnail beside a load's details on the web cards (so the list does not grow),
 * a modest one for messengers (the photo above the load's message).
 */
export type CargoImageSize = 'thumb' | 'message';
const SIZES: Record<CargoImageSize, { width: number; height: number; quality: number }> = {
  thumb: { width: 240, height: 180, quality: 72 },
  message: { width: 640, height: 400, quality: 78 },
};
// resized pictures, by photo (or kind) and size: a load's picture goes to many drivers
const CACHE_SIZE = 300;

export type CargoKind = 'general' | 'sacks' | 'steel' | 'produce' | 'liquid' | 'building' | 'container' | 'cold' | 'wood' | 'machinery';

/**
 * The words of a cargo type (or vehicle) that tell its kind; checked in this order, so «سیمان» is sacks, not building,
 * and «تخته سنگ» building, not wood. A load none of them fits gets the general photo (boxes on pallets).
 */
const KIND_WORDS: Array<[CargoKind, string[]]> = [
  ['cold', ['یخچال', 'منجمد', 'گوشت', 'مرغ', 'جوجه', 'لبنیات', 'ماهی', 'بستنی', 'سردخانه']],
  ['liquid', ['تانکر', 'سوخت', 'گازوئیل', 'بنزین', 'نفت', 'قیر', 'روغن', 'مایع', 'اسید', 'مازوت']],
  ['container', ['کانتینر', 'کانتینری']],
  ['machinery', ['ماشین‌آلات', 'دستگاه', 'ژنراتور', 'بیل مکانیکی', 'لودر', 'بولدوزر', 'تراکتور', 'کمباین', 'گریدر']],
  ['sacks', ['سیمان', 'گچ', 'آهک', 'کیسه', 'آرد', 'شکر', 'گندم', 'جو', 'برنج', 'ذرت', 'غلات', 'کود', 'پودر', 'نمک']],
  ['steel', ['میلگرد', 'آهن', 'تیرآهن', 'ورق', 'لوله', 'پروفیل', 'فولاد', 'نبشی', 'ناودانی', 'مس', 'آلومینیوم', 'کلاف', 'شمش']],
  ['produce', ['میوه', 'سیب', 'پرتقال', 'صیفی', 'گوجه', 'سبزی', 'خرما', 'هندوانه', 'پیاز', 'موز', 'خیار', 'انگور', 'لیمو']],
  ['building', ['سنگ', 'کاشی', 'سرامیک', 'آجر', 'ماسه', 'شن', 'بلوک', 'موزاییک', 'خاک', 'کمپرسی', 'مصالح']],
  ['wood', ['چوب', 'الوار', 'تخته', 'نئوپان', 'ام دی اف', 'mdf', 'فیبر', 'کابینت']],
];

// a word with one of these endings is still the word: «میلگردها»، «کانتینری»، «یخچالدار»، «صیفی‌جات»
const SUFFIXES = ['', 'ها', 'های', 'ی', 'ای', 'دار', 'جات', 'ات'];

/**
 * The words of a text, normalized. ZWNJ splits words here (normalizePersianText would join «آهن‌آلات»); matching whole
 * words keeps «کشمش» from being copper («مس») and «ماشین سنگین» from being stone («سنگ»).
 */
function words(text?: string | null): string[] {
  return normalizePersianText((text ?? '').replace(/\u200c/g, ' '))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const KIND_TOKENS: Array<[CargoKind, string[][]]> = KIND_WORDS.map(([kind, list]) => [kind, list.map(words)]);

/** the phrase's words one after another in the text, its last word with one of SUFFIXES */
function hasPhrase(tokens: string[], phrase: string[]): boolean {
  return tokens.some((_, start) =>
    phrase.every((word, i) => {
      const token = tokens[start + i];
      if (token === undefined) return false;
      return i < phrase.length - 1 ? token === word : SUFFIXES.some((suffix) => token === word + suffix);
    }),
  );
}

export interface CargoImageFields {
  photo?: string | null;
  cargoType?: string | null;
  vehicleType?: string | null;
}

/**
 * عکس بار برای نمایش تصویری (وب، ربات‌ها و واتساپ): عکسی که شرکت یا کارخانه گذاشته، وگرنه عکس واقعی نوع بار
 * (یا نوع خودرو) از src/assets/cargo-kinds. هر دو کوچک می‌شوند: بندانگشتی برای کارت‌های وب، متوسط برای پیام‌رسان‌ها.
 */
@Injectable()
export class CargoImageService {
  private readonly logger = new Logger(CargoImageService.name);
  private readonly cache = new Map<string, Buffer>();

  /** A photo a company or factory sends with a load: resized and kept as JPEG; its name goes on the load. */
  async store(file: Buffer): Promise<string> {
    let jpeg: Buffer;
    try {
      jpeg = await sharp(file).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    } catch {
      throw new BadRequestException('عکس خوانده نشد؛ یک عکس JPG، PNG یا WebP بفرستید.');
    }
    await mkdir(CARGO_PHOTO_DIR, { recursive: true });
    const name = `${randomUUID()}.jpg`;
    await writeFile(join(CARGO_PHOTO_DIR, name), jpeg);
    return name;
  }

  /** The load's picture as JPEG at the given size: its photo if it has one (and the file is there), else the photo of its kind. */
  async image(fields: CargoImageFields, size: CargoImageSize = 'message'): Promise<Buffer> {
    if (fields.photo && CARGO_PHOTO_NAME.test(fields.photo)) {
      const key = `${fields.photo}:${size}`;
      const cached = this.cache.get(key);
      if (cached) return cached;
      const photo = await readFile(join(CARGO_PHOTO_DIR, fields.photo)).catch(() => null);
      if (photo) return this.keep(key, await this.resize(photo, size));
      this.logger.warn(`Cargo photo ${fields.photo} is missing; the picture of its kind is shown`);
    }
    const kind = cargoKind(fields.cargoType, fields.vehicleType);
    const key = `${kind}:${size}`;
    return this.cache.get(key) ?? this.keep(key, await this.resize(await readFile(join(KIND_PHOTO_DIR, `${kind}.jpg`)), size));
  }

  private resize(jpeg: Buffer, size: CargoImageSize): Promise<Buffer> {
    const { width, height, quality } = SIZES[size];
    return sharp(jpeg).resize(width, height, { fit: 'cover', position: 'attention' }).jpeg({ quality, mozjpeg: true }).toBuffer();
  }

  private keep(key: string, jpeg: Buffer): Buffer {
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, jpeg);
    return jpeg;
  }
}

/** The kind of a load from its cargo type, then its vehicle; general boxes when neither tells. */
export function cargoKind(cargoType?: string | null, vehicleType?: string | null): CargoKind {
  for (const text of [cargoType, vehicleType]) {
    const tokens = words(text);
    if (!tokens.length) continue;
    const found = KIND_TOKENS.find(([, phrases]) => phrases.some((phrase) => hasPhrase(tokens, phrase)));
    if (found) return found[0];
  }
  return 'general';
}
