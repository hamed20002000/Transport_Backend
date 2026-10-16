import { GeoPoint, haversineKm } from '../routing/geo';
import { IranCrossing, iranCrossings } from '../routing/iranBorder';

/**
 * محل پایانه‌ی مرزی (سمت ایران) هر مرز borderpark، از OpenStreetMap («گمرک مرزی …»/«پایانه مرزی …»).
 * borderpark مختصات مرزها را نمی‌دهد و پایانه‌ها جابه‌جا نمی‌شوند؛ مرز تازه‌ی borderpark
 * تا اینجا اضافه نشود روی مسیر پیدا نمی‌شود (ولی در فهرست مرزها هست).
 */
export const BORDER_LOCATIONS: Record<string, GeoPoint> = {
  dgh: { lat: 34.713, lng: 60.9968 }, // دوغارون — افغانستان
  norduz: { lat: 38.8486, lng: 46.2012 }, // نوردوز — ارمنستان
  poldasht: { lat: 39.355, lng: 45.0588 }, // پلدشت — نخجوان
  astara: { lat: 38.4372, lng: 48.8782 }, // آستارا — آذربایجان
  bilehsavar: { lat: 39.3779, lng: 48.3499 }, // بیله‌سوار — آذربایجان
  jolfa: { lat: 38.9403, lng: 45.6409 }, // جلفا — نخجوان
  bashmaq: { lat: 35.6129, lng: 46.022 }, // باشماق — عراق
  pishin: { lat: 26.0802, lng: 61.7515 }, // پیشین — پاکستان
  rimdan: { lat: 25.39, lng: 61.6 }, // ریمدان — پاکستان
  lotfabad: { lat: 37.5241, lng: 59.339 }, // لطف‌آباد — ترکمنستان
  razi: { lat: 38.4962, lng: 44.3212 }, // رازی — ترکیه
  sero: { lat: 37.7186, lng: 44.6248 }, // سرو — ترکیه
  bazargan: { lat: 39.4112, lng: 44.3776 }, // بازرگان — ترکیه
};

// عبور از مرز با دقت مرز ساده‌شده (~۳ کیلومتر) و پایانه‌ای که گاهی چند کیلومتر داخل‌تر است
const MATCH_KM = 30;

export interface BorderOnRoute extends Omit<IranCrossing, 'point'> {
  id: string;
  /** فاصله‌ی پایانه تا جای عبور مسیر از مرز */
  offsetKm: number;
}

/** مرزهایی که مسیر از آن‌ها رد می‌شود، به ترتیب مسیر (صادرات: خروج، واردات: ورود، ترانزیت: هر دو). */
export function bordersOnRoute(route: GeoPoint[]): BorderOnRoute[] {
  const found: BorderOnRoute[] = [];
  for (const crossing of iranCrossings(route)) {
    let best: BorderOnRoute | null = null;
    for (const [id, location] of Object.entries(BORDER_LOCATIONS)) {
      const offsetKm = haversineKm(crossing.point, location);
      if (offsetKm <= MATCH_KM && (!best || offsetKm < best.offsetKm)) {
        best = { id, atKm: crossing.atKm, direction: crossing.direction, offsetKm };
      }
    }
    if (best && !found.some((item) => item.id === best!.id)) found.push(best);
  }
  return found;
}
