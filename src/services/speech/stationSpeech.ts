import {
  decimalToPersianWords,
  integerToPersianWords,
  spellNumbersInText,
} from '../../domain/helper/persianNumberWords';

/** مترجم کلیدهای trip.* (مثل TripDialog.t). */
export type TripTranslate = (key: string, args?: Record<string, string | number>) => string;

interface SpokenStation {
  name: string | null;
  diesel: boolean | null;
  cng: boolean | null;
}

/**
 * متن صوتی جایگاه‌های سوخت برای راننده‌ای که پشت فرمان است (ربات و وب با یک جمله‌بندی)؛
 * عددها به حروف تا Piper درست بخواندشان.
 */
function item(t: TripTranslate, station: SpokenStation, index: number, km: number): string {
  return t('near.voice.item', {
    index: integerToPersianWords(index + 1),
    name: station.name ? spellNumbersInText(station.name) : t('near.voice.unnamed'),
    km: decimalToPersianWords(km < 10 ? km : Math.round(km)),
    kinds: [station.diesel ? t('near.voice.diesel') : '', station.cng ? t('near.voice.cng') : ''].join(''),
  });
}

/** جایگاه‌های نزدیک راننده، به ترتیب نزدیکی (فاصله از راننده). */
export function nearStationsSpeech(t: TripTranslate, stations: (SpokenStation & { distanceKm: number })[]): string {
  return [t('near.voice.intro'), ...stations.map((station, i) => item(t, station, i, station.distanceKm))].join(' ');
}

/** جایگاه‌های کنار مسیر بار، از ابتدای مسیر (کیلومتر روی مسیر). */
export function routeStationsSpeech(t: TripTranslate, stations: (SpokenStation & { atKm: number })[]): string {
  if (!stations.length) return t('route.voice.none');
  return [
    t('route.voice.intro', { count: integerToPersianWords(stations.length) }),
    ...stations.map((station, i) =>
      t('route.voice.item', {
        index: integerToPersianWords(i + 1),
        name: station.name ? spellNumbersInText(station.name) : t('near.voice.unnamed'),
        km: integerToPersianWords(Math.round(station.atKm)),
        kinds: [station.diesel ? t('near.voice.diesel') : '', station.cng ? t('near.voice.cng') : ''].join(''),
      }),
    ),
  ].join(' ');
}
