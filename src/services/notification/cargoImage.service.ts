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

/** Where the photos of cargo and of vehicles are (one JPEG each, by the names below; sources in SOURCES.md). */
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

/**
 * The photo a load gets from its cargo type: the cargo itself. Checked in this order, so the narrow ones come before
 * the wide ones («کیسه جامبو» is jumbo, not sacks; «تخته سنگ» stone, not wood). A photo only for words it really
 * shows: a near miss (apples for dates) misleads more than a truck.
 */
const CARGO_PHOTOS: Array<[string, string[]]> = [
  ['jumbo', ['جامبو', 'جامبوبگ', 'بیگ بگ', 'بیگبگ']],
  ['petrochemical', ['پتروشیمی', 'گرانول', 'پلی اتیلن', 'پلی‌اتیلن', 'پلی پروپیلن', 'پلیمر', 'پی وی سی', 'pvc']],
  ['ingot', ['شمش']],
  ['rebar', ['میلگرد', 'مش', 'مفتول']],
  ['coil', ['ورق', 'کلاف', 'رول ورق']],
  ['pipe', ['لوله', 'لوله‌های', 'داربست']],
  ['barrel', ['بشکه', 'قیر', 'وازلین']],
  ['cotton', ['پنبه', 'الیاف']],
  ['pistachio', ['پسته']],
  ['raisins', ['کشمش']],
  ['dates', ['خرما']],
  // before apples: «سیب زمینی» is not «سیب»
  ['potato', ['سیب زمینی', 'سیب‌زمینی', 'سیبزمینی']],
  ['apples', ['سیب']],
  ['watermelon', ['هندوانه', 'خربزه', 'طالبی']],
  ['onion', ['پیاز']],
  ['chicken', ['مرغ', 'جوجه', 'گوشت', 'گوشت قرمز']],
  ['ibc', ['روغن', 'اسید', 'مایع', 'شیمیایی', 'مواد شیمیایی']],
  ['sacks', ['سیمان', 'گچ', 'آهک', 'کیسه', 'آرد', 'شکر', 'گندم', 'جو', 'برنج', 'ذرت', 'غلات', 'کود', 'نمک', 'سویا', 'خوراک دام', 'کنجاله']],
  ['bricks', ['آجر']],
  ['wood', ['چوب', 'الوار', 'تخته', 'نئوپان', 'ام دی اف', 'mdf', 'فیبر']],
  ['container', ['کانتینر', 'کانتینری']],
  ['machinery', ['ماشین‌آلات', 'ماشین آلات', 'بیل مکانیکی', 'لودر', 'بولدوزر', 'تراکتور', 'کمباین', 'گریدر']],
  ['boxes', ['پالت', 'کارتن', 'کارتنی', 'بیسکویت', 'کیک', 'شکلات', 'مواد غذایی', 'لوازم خانگی', 'لوازم']],
];

/** The photo a load gets from its vehicle when its cargo type has none: the truck it goes on. */
const VEHICLE_PHOTOS: Array<[string, string[]]> = [
  ['reefer', ['یخچال', 'یخچالی', 'یخچالدار', 'سردخانه']],
  ['tanker', ['تانکر', 'تانکردار']],
  ['tipper', ['کمپرسی', 'کمپرس']],
  ['container', ['کانتینر', 'کانتینری']],
  ['flatbed', ['کفی', 'کفی‌دار', 'لبه‌دار', 'لبه دار', 'بغل‌باز', 'بغل باز', 'تریلی', 'تریلر']],
  ['boxtruck', ['خاور', 'نیسان', 'کامیونت', 'وانت', 'ایسوزو', 'جک', 'ده چرخ', 'تک', 'جفت', 'کامیون']],
];

/** a load neither of them tells: a truck on the road, true of every load */
const FALLBACK_PHOTO = 'truck';

/** every photo cargoPhoto can name: each needs its JPEG in KIND_PHOTO_DIR */
export const CARGO_PHOTO_NAMES = [...new Set([...CARGO_PHOTOS, ...VEHICLE_PHOTOS].map(([photo]) => photo).concat(FALLBACK_PHOTO))];

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

const tokenize = (list: Array<[string, string[]]>): Array<[string, string[][]]> => list.map(([photo, phrases]) => [photo, phrases.map(words)]);
const CARGO_TOKENS = tokenize(CARGO_PHOTOS);
const VEHICLE_TOKENS = tokenize(VEHICLE_PHOTOS);

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
    const kind = cargoPhoto(fields.cargoType, fields.vehicleType);
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

/** The photo of a load: of its cargo type, else of its vehicle, else a truck (file name in KIND_PHOTO_DIR, no .jpg). */
export function cargoPhoto(cargoType?: string | null, vehicleType?: string | null): string {
  const match = (text: string | null | undefined, list: Array<[string, string[][]]>) => {
    const tokens = words(text);
    return tokens.length ? list.find(([, phrases]) => phrases.some((phrase) => hasPhrase(tokens, phrase)))?.[0] : undefined;
  };
  return match(cargoType, CARGO_TOKENS) ?? match(vehicleType, VEHICLE_TOKENS) ?? FALLBACK_PHOTO;
}
