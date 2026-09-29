import { CargoDetectedEvent } from '../../domain/constants/cargoEvents';

/** متن ساده‌ی اعلان بار؛ برای تلگرام و واتساپ یکسان است (بدون Markdown/HTML). */
export function buildCargoNotificationText(event: CargoDetectedEvent): string {
  const rows: [string, string | null | undefined][] = [
    ['کد بار', event.code],
    ['مبدا', event.origin],
    ['مقصد', event.destination],
    ['نوع بار', event.cargoType],
    ['وزن', event.weight],
    ['نوع ماشین', event.vehicleType],
    ['کرایه', event.price],
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

/** متن پیام قبلی وقتی بار برداشته شد؛ پیام ویرایش می‌شود، پیام جدید نمی‌رود. */
export function buildCargoTakenText(originalText: string): string {
  return `❌ این بار برداشته شد\n\n${originalText}`;
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
}

/** متن باری که شرکت برای راننده‌ها منتشر می‌کند (فیلد: مقدار). */
export function buildCargoListingText(fields: CargoListingFields): string {
  const rows: [string, string | null | undefined][] = [
    ['کد بار', fields.code],
    ['شرکت', fields.companyName],
    ['مبدا', fields.origin],
    ['مقصد', fields.destination],
    ['نوع بار', fields.cargoType],
    ['وزن', fields.weight],
    ['نوع ماشین', fields.vehicleType],
    ['کرایه', fields.price],
    ['توضیحات', fields.extraNotes],
    ['تماس', fields.contactPhones.join(' - ')],
  ];

  return ['🚚 بار جدید', ...rows.filter(([, value]) => value && value.trim()).map(([title, value]) => `${title}: ${value!.trim()}`)]
    .join('\n');
}
