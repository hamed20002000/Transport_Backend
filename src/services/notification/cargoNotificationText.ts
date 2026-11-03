import { CargoTripType } from '../../domain/enums/notification';
import { TRIP_TYPE_LABELS } from './cargoTripType';
import { CargoDetectedEvent } from '../../domain/constants/cargoEvents';
import { card } from '../messengerBot/core/botCard';
import { groupDigits } from '../../domain/helper/digitGroups';

// messengers have no text colour: the orange mark makes the code (what drivers quote on the phone) stand out,
// like the orange code chip on the web cards
const CODE_TITLE = '🟠 کد بار';

/** متن ساده‌ی اعلان بار؛ برای تلگرام و واتساپ یکسان است (بدون Markdown/HTML). */
export function buildCargoNotificationText(event: CargoDetectedEvent): string {
  const rows: [string, string | null | undefined][] = [
    [CODE_TITLE, event.code],
    ['مبدا', event.origin],
    ['مقصد', event.destination],
    ['نوع بار', event.cargoType],
    ['وزن', groupDigits(event.weight)],
    ['نوع ماشین', event.vehicleType],
    ['کرایه', groupDigits(event.price)],
    ['توضیحات', event.extraNotes],
  ];

  const details = rows
    .filter(([, value]) => value && String(value).trim())
    .map(([title, value]) => `${title}: ${value}`);

  const body = details.length > 0
    ? details.join('\n')
    : (event.processedText || event.rawText || '').trim();

  return ['🚚 بار جدید', body, event.rawText && details.length > 0 ? `\nمتن اصلی:\n${event.rawText.trim()}` : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 3500);
}

/**
 * اعلان کوتاه پیشنهاد بار در پیام‌رسان‌ها؛ جزئیات بار فقط در لیست «بارهای
 * پیشنهادی» دیده می‌شود (وب همچنان متن کامل را نشان می‌دهد).
 */
export function buildCargoSuggestionNotice(unreadCount: number, openHint?: string): string {
  return [
    '📥 بار جدید در کانال‌های شما دیده شد.',
    unreadCount > 0 ? `${toPersianDigits(unreadCount)} بار خوانده‌نشده دارید.` : '',
    openHint ?? '',
  ]
    .filter(Boolean)
    .join('\n');
}

const toPersianDigits = (value: number) => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** متن پیام قبلی وقتی بار برداشته شد؛ پیام ویرایش می‌شود، پیام جدید نمی‌رود. */
/**
 * اعلان بار در پیام‌رسان‌ها: عنوان‌ها («🚚 بار جدید»، «❌ این بار برداشته شد») بیرون و ردیف‌های
 * «عنوان: مقدار» در کارت. متن ذخیره‌شده (وب، فهرست‌ها) دست نمی‌خورد؛ فقط هنگام ارسال.
 */
export function cargoTextWithCard(text: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^[^:\n]{1,20}: /.test(line));
  if (start < 0) return text;
  return [...lines.slice(0, start), card(lines.slice(start).join('\n'))].join('\n');
}

export function buildCargoTakenText(originalText: string): string {
  return `❌ این بار برداشته شد\n\n${originalText}`;
}

/** A load as a line of a summary message. */
export interface CargoDigestItem {
  code?: string | null;
  origin: string;
  destination: string;
  cargoType?: string | null;
  weight?: string | null;
  vehicleType?: string | null;
  price?: string | null;
  taken: boolean;
}

/** The most loads one summary lists; the rest are counted. */
export const CARGO_DIGEST_MAX_ITEMS = 10;

/**
 * Several loads to a driver in one message: a line each («۱) TRB123 · تهران ← مشهد · کاشی · ۲۲ تن · ۴۵٬۰۰۰٬۰۰۰»),
 * a taken one marked; past CARGO_DIGEST_MAX_ITEMS only counted. hint: how to see one (WhatsApp, which has no buttons).
 */
export function buildCargoDigestText(items: CargoDigestItem[], hint?: string): string {
  const fa = (value: number) => value.toLocaleString('fa-IR');
  const lines = items.slice(0, CARGO_DIGEST_MAX_ITEMS).map((item, index) => {
    const details = [item.code, `${item.origin} ← ${item.destination}`, item.cargoType, groupDigits(item.weight), item.vehicleType, groupDigits(item.price)]
      .filter((part) => part && String(part).trim())
      .join(' · ');
    return `${fa(index + 1)}) ${item.taken ? '❌ برداشته شد · ' : ''}${details}`;
  });
  const more = items.length - CARGO_DIGEST_MAX_ITEMS;
  return [
    `📦 ${fa(items.length)} بار تازه برای شما`,
    lines.join('\n\n'),
    more > 0 ? `و ${fa(more)} بار دیگر؛ همه را در «پیدا کردن بار» ببینید.` : '',
    hint ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface CargoListingFields {
  // کد پیگیری؛ شرکت نمی‌تواند عوضش کند و CargoListingService تعیینش می‌کند.
  code?: string | null;
  companyName?: string | null;
  origin: string;
  destination: string;
  cargoType?: string | null;
  weight?: string | null;
  vehicleType?: string | null;
  price?: string | null;
  extraNotes?: string | null;
  contactPhones: string[];
  // عکس بار (CargoImageService)؛ فقط برای نمایش تصویری، در متن نمی‌آید
  photo?: string | null;
  // داخلی/صادراتی/وارداتی، که CargoListingService از مبدأ و مقصد تشخیص می‌دهد (فقط برای متن)
  tripType?: CargoTripType | null;
}

/** متن باری که شرکت برای راننده‌ها منتشر می‌کند (فیلد: مقدار). */
export function buildCargoListingText(fields: CargoListingFields): string {
  const rows: [string, string | null | undefined][] = [
    [CODE_TITLE, fields.code],
    ['شرکت حمل‌ونقل', fields.companyName],
    ['مبدا', fields.origin],
    ['مقصد', fields.destination],
    ['نوع حمل', fields.tripType ? TRIP_TYPE_LABELS[fields.tripType] : null],
    ['نوع بار', fields.cargoType],
    ['وزن', groupDigits(fields.weight)],
    ['نوع ماشین', fields.vehicleType],
    ['کرایه', groupDigits(fields.price)],
    ['توضیحات', fields.extraNotes],
    ['تماس', fields.contactPhones.join(' - ')],
  ];

  return ['🚚 بار جدید', ...rows.filter(([, value]) => value && value.trim()).map(([title, value]) => `${title}: ${value!.trim()}`)]
    .join('\n');
}
