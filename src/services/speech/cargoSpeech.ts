import { spellNumbersInText } from '../../domain/helper/persianNumberWords';
import { TripTranslate } from './stationSpeech';

// توضیحات طولانی صدا را چنددقیقه‌ای می‌کند؛ متن کامل در پیام هست
const MAX_NOTES_LENGTH = 200;

interface SpokenListing {
  code: string;
  companyName?: string | null;
  origin: string;
  destination: string;
  cargoType?: string | null;
  weight?: string | null;
  vehicleType?: string | null;
  price?: string | null;
  extraNotes?: string | null;
}

/**
 * متن صوتی بار اعلام‌شده برای راننده‌ای که پشت فرمان است (مثل جایگاه‌های سوخت)؛
 * عددها به حروف تا Piper درست بخواندشان. شماره‌ی تماس خوانده نمی‌شود: درخواست با دکمه است.
 */
export function cargoListingSpeech(t: TripTranslate, listing: SpokenListing): string {
  const say = (key: string, value?: string | null) =>
    value?.trim() ? t(`listing.voice.${key}`, { value: spellNumbersInText(value.trim()) }) : '';
  const notes = listing.extraNotes?.trim();
  return [
    t('listing.voice.intro'),
    t('listing.voice.route', { origin: spellNumbersInText(listing.origin), destination: spellNumbersInText(listing.destination) }),
    say('vehicleType', listing.vehicleType),
    say('cargoType', listing.cargoType),
    say('weight', listing.weight),
    say('price', listing.price),
    say('company', listing.companyName),
    say('notes', notes && notes.length > MAX_NOTES_LENGTH ? `${notes.slice(0, MAX_NOTES_LENGTH)}…` : notes),
    // «TRB100234» → فقط رقم‌ها؛ جستجوی کد با رقم‌های تنها هم کار می‌کند (cargoCodeMatch)
    say('code', listing.code.replace(/\D/g, '')),
  ]
    .filter(Boolean)
    .join(' ');
}
