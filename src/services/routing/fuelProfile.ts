import { normalizePersianText } from '../../domain/helper/persianText';

/**
 * مصرف تقریبی سوخت (لیتر در ۱۰۰ کیلومتر، بار کامل) و ضریب زمان رانندگی نسبت
 * به خودروی سواری. اعداد میانگین ناوگان باری ایران‌اند؛ مصرف واقعی به
 * مدل موتور، وزن بار، شیب جاده و سبک رانندگی بستگی دارد.
 */
export interface FuelProfile {
  key: string;
  label: string;
  fuel: 'diesel' | 'gasoline';
  litersPer100Km: number;
  // زمان کامیون نسبت به زمان مسیریاب (سرعت مجاز و شتاب کمتر)
  durationFactor: number;
}

// ترتیب مهم است: «کامیونت» شامل «کامیون» و «فوتون وانت» شامل «فوتون» است.
const PROFILES: { words: string[]; profile: FuelProfile }[] = [
  {
    words: ['تریلی', 'تریلر', 'کشنده', 'کفی', 'لبه‌دار', 'لبه دار', 'یخچال‌دار تریلی', 'بغل‌باز', 'بغل باز', 'کمپرسی تریلی'],
    profile: { key: 'trailer', label: 'تریلی', fuel: 'diesel', litersPer100Km: 38, durationFactor: 1.35 },
  },
  {
    words: ['ده‌چرخ', 'ده چرخ', '۱۰ چرخ', '10 چرخ', 'دهچرخ', 'جفت', 'جفت‌محور', 'کمپرسی'],
    profile: { key: 'tenWheel', label: 'ده‌چرخ', fuel: 'diesel', litersPer100Km: 31, durationFactor: 1.3 },
  },
  {
    words: ['نیسان', 'وانت', 'پیکان', 'مزدا', 'آریسان', 'پراید وانت', 'زامیاد', 'کارا', 'فوتون وانت'],
    profile: { key: 'pickup', label: 'وانت/نیسان', fuel: 'gasoline', litersPer100Km: 12, durationFactor: 1.05 },
  },
  {
    words: ['خاور', 'کامیونت', 'ایسوزو', 'ایسوز', '۸۰۸', '808', 'هیوندای', 'جک', 'فوتون', 'میتسوبیشی'],
    profile: { key: 'lightTruck', label: 'خاور/کامیونت', fuel: 'diesel', litersPer100Km: 17, durationFactor: 1.15 },
  },
  {
    words: ['کامیون', 'تک', 'شش‌چرخ', 'شش چرخ', '۶ چرخ', '6 چرخ', 'تک‌محور', 'بنز'],
    profile: { key: 'truck', label: 'کامیون (تک)', fuel: 'diesel', litersPer100Km: 26, durationFactor: 1.25 },
  },
];

/** وقتی نوع ماشین در بار نیامده یا شناخته نشد: میانگین ده‌چرخ و تریلی. */
export const DEFAULT_FUEL_PROFILE: FuelProfile = {
  key: 'unknown',
  label: 'کامیون سنگین (نوع ماشین مشخص نیست)',
  fuel: 'diesel',
  litersPer100Km: 33,
  durationFactor: 1.3,
};

export function fuelProfileFor(vehicleType: string | null | undefined): FuelProfile {
  const text = normalizePersianText(vehicleType ?? '');
  if (!text) return DEFAULT_FUEL_PROFILE;
  for (const { words, profile } of PROFILES) {
    if (words.some((word) => text.includes(normalizePersianText(word)))) return profile;
  }
  return DEFAULT_FUEL_PROFILE;
}

export function estimateFuelLiters(distanceKm: number, profile: FuelProfile): number {
  return Math.round((distanceKm * profile.litersPer100Km) / 100);
}
