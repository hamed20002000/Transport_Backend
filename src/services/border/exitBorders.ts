import { GeoPoint, haversineKm } from '../routing/geo';
import { iranCrossings, isInIran } from '../routing/iranBorder';

/** An Iranian land border a load leaves (or enters) Iran by: its Persian name, the country across it, where it is. */
export interface ExitBorder {
  /** its borderpark id (BORDER_LOCATIONS), for the ones a route's crossings are matched to */
  id?: string;
  name: string;
  country: string;
  point: GeoPoint;
}

/**
 * The land borders trucks cross, each at its Iranian terminal (rough coordinates: enough to tell which are near a
 * place abroad). Wider than BORDER_LOCATIONS (borderpark's, for queue status): a driver may leave by any of these.
 */
export const EXIT_BORDERS: ExitBorder[] = [
  { id: 'bazargan', name: 'بازرگان', country: 'ترکیه', point: { lat: 39.411, lng: 44.378 } },
  { id: 'razi', name: 'رازی', country: 'ترکیه', point: { lat: 38.496, lng: 44.321 } },
  { id: 'sero', name: 'سرو', country: 'ترکیه', point: { lat: 37.719, lng: 44.625 } },
  { id: 'norduz', name: 'نوردوز', country: 'ارمنستان', point: { lat: 38.849, lng: 46.201 } },
  { id: 'jolfa', name: 'جلفا', country: 'نخجوان', point: { lat: 38.94, lng: 45.641 } },
  { id: 'poldasht', name: 'پلدشت', country: 'نخجوان', point: { lat: 39.355, lng: 45.059 } },
  { id: 'astara', name: 'آستارا', country: 'آذربایجان', point: { lat: 38.437, lng: 48.878 } },
  { id: 'bilehsavar', name: 'بیله‌سوار', country: 'آذربایجان', point: { lat: 39.378, lng: 48.35 } },
  { name: 'تمرچین', country: 'عراق', point: { lat: 36.65, lng: 45.1 } },
  { id: 'bashmaq', name: 'باشماق', country: 'عراق', point: { lat: 35.613, lng: 46.022 } },
  { name: 'پرویزخان', country: 'عراق', point: { lat: 34.57, lng: 45.52 } },
  { name: 'خسروی', country: 'عراق', point: { lat: 34.37, lng: 45.47 } },
  { name: 'مهران', country: 'عراق', point: { lat: 33.1, lng: 46.12 } },
  { name: 'چذابه', country: 'عراق', point: { lat: 31.86, lng: 47.84 } },
  { name: 'شلمچه', country: 'عراق', point: { lat: 30.5, lng: 47.98 } },
  { name: 'اینچه‌برون', country: 'ترکمنستان', point: { lat: 37.43, lng: 54.72 } },
  { name: 'باجگیران', country: 'ترکمنستان', point: { lat: 37.6, lng: 58.42 } },
  { id: 'lotfabad', name: 'لطف‌آباد', country: 'ترکمنستان', point: { lat: 37.524, lng: 59.339 } },
  { name: 'سرخس', country: 'ترکمنستان', point: { lat: 36.54, lng: 61.16 } },
  { id: 'dgh', name: 'دوغارون', country: 'افغانستان', point: { lat: 34.713, lng: 60.997 } },
  { name: 'میلک', country: 'افغانستان', point: { lat: 31.05, lng: 61.77 } },
  { name: 'میرجاوه', country: 'پاکستان', point: { lat: 29.02, lng: 61.45 } },
  { id: 'pishin', name: 'پیشین', country: 'پاکستان', point: { lat: 26.08, lng: 61.752 } },
  { id: 'rimdan', name: 'ریمدان', country: 'پاکستان', point: { lat: 25.39, lng: 61.6 } },
];

// a border of another country still offered when about as near as the nearest one (Poldasht, by Nakhchivan, for
// Turkey): within this much further; a ratio would take in half the north-west for a far destination
const NEAR_KM = 40;
const MAX_CHOICES = 6;

/**
 * The country across Iran's land border a place is in, by its Latin name's country («Ankara, Turkey» → «ترکیه»), as
 * EXIT_BORDERS names it; Nakhchivan apart from the rest of Azerbaijan (its borders are not the way to Baku). null: a
 * country with no land border with Iran (Georgia, Russia, Bulgaria…) or no country given.
 */
export function neighbourOf(latinName: string | null | undefined): string | null {
  const name = latinName?.toLowerCase() ?? '';
  if (!name.includes(',')) return null;
  if (/nakh(i)?chevan|nakhchivan|naxçıvan|naxcivan/.test(name)) return 'نخجوان';
  const country = name.split(',').pop()!.trim();
  const NEIGHBOURS: Array<[RegExp, string]> = [
    [/^(turkey|t[uü]rkiye)\b/, 'ترکیه'],
    [/^iraq\b|kurdistan/, 'عراق'],
    [/^armenia\b/, 'ارمنستان'],
    [/^azerbaijan\b/, 'آذربایجان'],
    [/^turkmenistan\b/, 'ترکمنستان'],
    [/^afghanistan\b/, 'افغانستان'],
    [/^pakistan\b/, 'پاکستان'],
  ];
  return NEIGHBOURS.find(([pattern]) => pattern.test(country))?.[1] ?? null;
}

/** The borders to a neighbouring country (neighbourOf), in the list's order. */
export const bordersOf = (country: string): ExitBorder[] => EXIT_BORDERS.filter((border) => border.country === country);

/** The border of a borderpark id (a crossing found on a route, bordersOnRoute). */
export const exitBorderById = (id: string): ExitBorder | undefined => EXIT_BORDERS.find((border) => border.id === id);

// a route's crossing of Iran's (simplified) border to the terminal it belongs to: as bordersOnRoute
const CROSSING_KM = 30;

/**
 * The borders a route crosses, in its order: each crossing of Iran's border matched to the nearest of all the
 * borders here (not only the ones borderpark reports a queue for), so Mehran or Sarakhs count too.
 */
export function exitBordersOnRoute(route: GeoPoint[]): ExitBorder[] {
  const found: ExitBorder[] = [];
  for (const crossing of iranCrossings(route)) {
    const nearest = EXIT_BORDERS.map((border) => ({ border, km: haversineKm(crossing.point, border.point) })).sort((a, b) => a.km - b.km)[0];
    if (nearest && nearest.km <= CROSSING_KM && !found.includes(nearest.border)) found.push(nearest.border);
  }
  return found;
}

/**
 * The borders to offer for a place abroad, nearest first: those to the country of the nearest one, and any other
 * about as near. A place not found, or found inside Iran, gets them all (by name).
 */
export function bordersToward(place: GeoPoint | null): ExitBorder[] {
  if (!place || isInIran(place)) return [...EXIT_BORDERS].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  const byDistance = EXIT_BORDERS.map((border) => ({ border, km: haversineKm(place, border.point) })).sort((a, b) => a.km - b.km);
  const nearest = byDistance[0];
  return byDistance
    .filter(({ border, km }) => border.country === nearest.border.country || km <= nearest.km + NEAR_KM)
    .slice(0, MAX_CHOICES)
    .map(({ border }) => border);
}
