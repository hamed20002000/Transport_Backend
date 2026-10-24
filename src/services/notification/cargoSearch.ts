import { textParam, ToolParam } from 'src/application/services/agent/tools/toolKit';
import { normalizePersianText } from '../../domain/helper/persianText';
import { CargoRouteFields } from './cargoAlertFilter.service';
import { IRAN_PROVINCES } from '../../domain/helper/iranProvinces';
import { CargoTripType } from '../../domain/enums/notification';
import { parseTripType, TRIP_TYPE_LABELS } from './cargoTripType';

/**
 * جستجوی لحظه‌ای در لیست بارها (مثلاً «لیست بارهای کارتن از تهران» در agent)؛
 * هر فیلد اگر آمده باشد باید در همان فیلد بار «وجود داشته باشد»، مثل فیلترهای اعلان.
 */
export interface CargoSearch {
  origin?: string;
  destination?: string;
  cargoType?: string;
  vehicleType?: string;
  /** داخلی/صادراتی/وارداتی (متن آزاد، مثل «صادراتی» یا EXPORT)؛ نوع سفر است، نه نوع کالا */
  tripType?: string;
}

const FIELDS = ['origin', 'destination', 'cargoType', 'vehicleType'] as const;
type Field = (typeof FIELDS)[number];
// مبدأ و مقصد می‌توانند چند مکان (هر کدام) یا اسم استان باشند
const PLACE_FIELDS: ReadonlySet<Field> = new Set(['origin', 'destination']);

/** خروجی prepareCargoSearch: برای هر فیلد پرشده، آیا مقدار همان فیلد بار جور است. */
export type PreparedCargoSearch = Partial<Record<Field, (value: string) => boolean>> & { tripType?: CargoTripType };

// «یزد، اصفهان و شیراز»، «هرمزگان یا بوشهر»، «تبریز/مرند»
const PLACE_SEPARATOR = /\s*(?:[،,\/|؛;]|\s+و\s+|\s+یا\s+)\s*/;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PROVINCES = IRAN_PROVINCES.map((province) => ({
  names: new Set(province.names.map(normalizePersianText)),
  capitalNamed: province.capitalNamed ? normalizePersianText(province.capitalNamed) : null,
  // شهرهای استان با کل کلمه تطبیق داده می‌شوند تا «بم» یا «جم» داخل کلمه‌ی دیگر پیدا نشود
  cities: new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${province.cities.map((city) => escape(normalizePersianText(city))).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'u'),
}));

// اسم‌هایی که خودشان «و» دارند و نباید از وسط جدا شوند («سیستان، بلوچستان» → «سیستان و بلوچستان»)
const JOINED_NAMES = new Set(
  IRAN_PROVINCES.flatMap((province) => [...province.names, ...province.cities])
    .map(normalizePersianText)
    .filter((name) => name.includes(' و ')),
);

function splitPlaces(value: string): string[] {
  const parts = value.split(PLACE_SEPARATOR).filter(Boolean);
  const places: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const joined = i + 1 < parts.length ? `${parts[i]} و ${parts[i + 1]}` : '';
    if (JOINED_NAMES.has(joined)) {
      places.push(joined);
      i++;
    } else places.push(parts[i]);
  }
  return places;
}

/**
 * یک مکان: هر بار که اسمش را داشته باشد (مثل قبل، جزئی هم کافی است: «کرما» → «کرمان»)،
 * و اگر اسم استان است هر بار از شهرهای آن استان. استانی که هم‌نام مرکزش است
 * («کرمان») فقط با «استان کرمان» کل استان است.
 */
function placeMatcher(place: string): (value: string) => boolean {
  const provinceOnly = /^استان\s+/.test(place);
  const name = place.replace(/^استان\s+/, '');
  const provinces = PROVINCES.filter(
    (province) => province.names.has(name) || (provinceOnly && province.capitalNamed === name),
  );
  return (value) => value.includes(name) || provinces.some((province) => province.cities.test(value));
}

/** فقط فیلدهای پرشده، یکسان‌شده؛ null یعنی جستجویی در کار نیست. */
export function prepareCargoSearch(search: CargoSearch): PreparedCargoSearch | null {
  const prepared: PreparedCargoSearch = {};
  for (const field of FIELDS) {
    const value = search[field] ? normalizePersianText(search[field]!) : '';
    if (!value) continue;
    if (PLACE_FIELDS.has(field)) {
      const matchers = splitPlaces(value).map(placeMatcher);
      prepared[field] = (cargoValue) => matchers.some((matches) => matches(cargoValue));
    } else {
      prepared[field] = (cargoValue) => cargoValue.includes(value);
    }
  }
  // متنی که نوع سفر نیست نادیده گرفته می‌شود، نه اینکه هیچ باری پیدا نشود
  const tripType = parseTripType(search.tripType);
  if (tripType) prepared.tripType = tripType;
  return Object.keys(prepared).length ? prepared : null;
}

/** search باید خروجی prepareCargoSearch باشد. باری که نوع سفرش معلوم نیست با فیلتر نوع سفر جور نیست. */
export function matchesCargoSearch(cargo: CargoRouteFields, search: PreparedCargoSearch): boolean {
  if (search.tripType && cargo.tripType !== search.tripType) return false;
  return FIELDS.every((field) => !search[field] || search[field]!(normalizePersianText(cargo[field] ?? '')));
}

/** شرط‌های جستجو برای متن جواب: « کارتن از تهران به کرج با تریلی» */
export function cargoSearchText(search: CargoSearch): string {
  const { cargoType, origin, destination, vehicleType } = search;
  const tripType = parseTripType(search.tripType);
  return [
    tripType && ` ${TRIP_TYPE_LABELS[tripType]}`,
    cargoType && ` ${cargoType}`,
    origin && ` از ${origin}`,
    destination && ` به ${destination}`,
    vehicleType && ` با ${vehicleType}`,
  ]
    .filter(Boolean)
    .join('');
}

/** شرط‌های جستجو از پارامترهای ابزار agent (origin، destination، cargoType، vehicleType، tripType). */
export function searchFromParams(param: ToolParam): CargoSearch {
  return {
    origin: textParam(param.origin),
    destination: textParam(param.destination),
    cargoType: textParam(param.cargoType),
    vehicleType: textParam(param.vehicleType),
    tripType: textParam(param.tripType),
  };
}
