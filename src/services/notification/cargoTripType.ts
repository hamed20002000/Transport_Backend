import { Injectable, Logger } from '@nestjs/common';

import { CargoTripType } from '../../domain/enums/notification';
import { IRAN_PROVINCES } from '../../domain/helper/iranProvinces';
import { normalizePersianText } from '../../domain/helper/persianText';
import { llmAnswer } from '../common/llmClient';
import { RedisService } from '../redis/redis.service';
import { RoutingService } from '../routing/routing.service';

export const TRIP_TYPE_LABELS: Record<CargoTripType, string> = {
  [CargoTripType.Domestic]: 'داخلی',
  [CargoTripType.Export]: 'صادراتی',
  [CargoTripType.Import]: 'وارداتی',
};

/**
 * A driver is domestic, international, or both: an international driver takes both export and import loads.
 * The load keeps its own type (export / import / domestic) for its label and the statistics; the driver keeps
 * the load types it takes in DriverProfile.tripTypes, so matching a load to drivers stays one array test.
 */
export type DriverKind = 'DOMESTIC' | 'INTERNATIONAL';

export const DRIVER_KIND_TRIP_TYPES: Record<DriverKind, CargoTripType[]> = {
  DOMESTIC: [CargoTripType.Domestic],
  INTERNATIONAL: [CargoTripType.Export, CargoTripType.Import],
};

export const DRIVER_KIND_LABELS: Record<DriverKind, string> = { DOMESTIC: 'داخلی', INTERNATIONAL: 'بین‌المللی' };

/** The kind of driver a load goes to: an export or import load goes to international drivers. */
export function driverKindForLoad(tripType: CargoTripType | null | undefined): DriverKind {
  return tripType === CargoTripType.Export || tripType === CargoTripType.Import ? 'INTERNATIONAL' : 'DOMESTIC';
}

/** A driver's kind from the load types it had: any export or import makes it international. */
export function driverKindOf(tripTypes: readonly (CargoTripType | null | undefined)[]): DriverKind {
  return tripTypes.some((type) => driverKindForLoad(type) === 'INTERNATIONAL') ? 'INTERNATIONAL' : 'DOMESTIC';
}

/** A driver's kinds from the load types it takes: domestic, international, or both (domestic when none). */
export function driverKindsOf(tripTypes: readonly (CargoTripType | null | undefined)[]): DriverKind[] {
  const kinds = (['DOMESTIC', 'INTERNATIONAL'] as const).filter((kind) => tripTypes.some((type) => type && driverKindForLoad(type) === kind));
  return kinds.length ? kinds : ['DOMESTIC'];
}

/** What a driver profile stores for these load types: all the types of each of its kinds (one or both). */
export function driverTripTypes(tripTypes: readonly (CargoTripType | null | undefined)[]): CargoTripType[] {
  return driverKindsOf(tripTypes).flatMap((kind) => DRIVER_KIND_TRIP_TYPES[kind]);
}

/** «بین‌المللی»، «خارجی»، «صادرات/واردات» → INTERNATIONAL؛ «داخلی» → DOMESTIC (agent، ربات). */
export function parseDriverKind(value: unknown): DriverKind | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'international' || /بین.?الملل|خارج|ترانزیت/.test(text)) return 'INTERNATIONAL';
  const type = parseTripType(text);
  return type ? driverKindForLoad(type) : null;
}

/** «صادراتی» → EXPORT؛ متن آزاد (اکسل، agent) هم: «صادرات»، «export»، «داخل». */
export function parseTripType(value: unknown): CargoTripType | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (Object.values(CargoTripType).includes(text.toUpperCase() as CargoTripType)) return text.toUpperCase() as CargoTripType;
  if (/صادر|export/.test(text)) return CargoTripType.Export;
  if (/وارد|import/.test(text)) return CargoTripType.Import;
  if (/داخل|domestic/.test(text)) return CargoTripType.Domestic;
  return null;
}

// گذرگاه‌های مرزی و بندرهای ایران که در فهرست شهرهای استان‌ها نیستند
const IRAN_CROSSINGS_AND_PORTS = [
  'ایران', 'لطف‌آباد', 'باجگیران', 'پرویزخان', 'شلمچه', 'نوردوز', 'رازی', 'تمرچین', 'باشماق', 'چذابه',
  'میلک', 'ریمدان', 'کوهک', 'جلفا', 'شهید رجایی', 'بندر امام خمینی', 'امیرآباد', 'بندر انزلی', 'سرخس', 'دوغارون',
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// «لطف‌آباد»، «لطف آباد» و «لطف اباد» یک اسم‌اند: آ مثل ا و نیم‌فاصله حذف؛ فاصله برای مرز کلمه می‌ماند
const looseWords = (text: string) => normalizePersianText(text).replace(/آ/g, 'ا').replace(/‌/g, '');

const IRAN_NAMES = [...IRAN_PROVINCES.flatMap((p) => [...p.names, ...(p.capitalNamed ? [p.capitalNamed] : []), ...p.cities]), ...IRAN_CROSSINGS_AND_PORTS]
  .map(looseWords)
  .filter(Boolean);

// اسم‌های داخل ایران با کل کلمه («تهران - میدان آزادی» ایران است، «جم» داخل کلمه‌ی دیگر نه)؛ هر اسم
// چندکلمه‌ای بی‌فاصله هم («شهر ری» / «شهرری»)
const IRAN_PLACES = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(?:${[...new Set(IRAN_NAMES.flatMap((name) => [name, name.replace(/ /g, '')]))].map(escape).join('|')})(?=$|[^\\p{L}\\p{N}])`,
  'u',
);

/** فهرست ثابت: اسم (یا همان اسم بی‌فاصله، «لطف اباد») از شهرها/استان‌ها/گذرگاه‌های ایران است. */
export function isKnownIranPlace(place: string): boolean {
  const words = looseWords(place);
  return IRAN_PLACES.test(words) || IRAN_PLACES.test(words.replace(/ /g, ''));
}

const ROUTE_PROMPT = `You classify place names taken from Iranian freight (cargo) messages.
Names are usually in Persian script and may be Iranian cities, villages, industrial areas, ports or border crossings,
or foreign places transliterated into Persian — often in Turkey, Iraq, the Caucasus, Central Asia, Afghanistan,
Pakistan or the Persian Gulf countries. The Iranian side of a border crossing is in Iran.
You get one cargo route (origin → destination); the other end of the route is context, e.g. a route to an
Iran–Turkey border crossing usually starts in Turkey.
Return the country of each end and whether it is inside Iran; null when you do not recognise a place.`;

const ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    origin_country: { type: ['string', 'null'] },
    origin_in_iran: { type: ['boolean', 'null'] },
    destination_country: { type: ['string', 'null'] },
    destination_in_iran: { type: ['boolean', 'null'] },
  },
  required: ['origin_country', 'origin_in_iran', 'destination_country', 'destination_in_iran'],
};

const LATIN_PROMPT = `You get one cargo route from an Iranian freight message (origin → destination), place names in
Persian script; one end is outside Iran. For each end give its usual Latin-script name as a world map search would find
it, with its country: «آنتب» → «Gaziantep, Turkey», «امبارلی» → «Ambarli, Istanbul, Turkey», «قبضه» → «Kapıköy, Turkey».
A Persian spelling of a foreign name may differ from the usual one (ب for پ, missing vowels); use the other end as
context. null for an end you do not recognise.`;

const LATIN_SCHEMA = {
  type: 'object',
  properties: { origin: { type: ['string', 'null'] }, destination: { type: ['string', 'null'] } },
  required: ['origin', 'destination'],
};

// مسیر جایش عوض نمی‌شود؛ فقط جواب کامل کش می‌شود تا «نمی‌دانم» بعداً دوباره پرسیده شود
const ROUTE_TTL_SECONDS = 180 * 24 * 3600;

type Side = boolean | null;

/** «Pleven, Bulgaria» → false (abroad), «Bam, Iran» → true, no country → null: by the last part, the country. */
export function latinSide(name: string | null | undefined): Side {
  const country = name?.split(',').pop()?.trim();
  if (!country || !name!.includes(',')) return null;
  return /^iran\b/i.test(country) || /islamic republic of iran/i.test(country);
}

/**
 * نوع بار از مبدأ و مقصد: ایران → خارج صادراتی، خارج → ایران وارداتی، هر دو ایران داخلی، هر دو خارج
 * (ترانزیت) صادراتی. هر طرف: فهرست شهرها/استان‌ها/گذرگاه‌های ایران؛ اگر نبود، کل مسیر از مدل پرسیده
 * می‌شود (اول OpenAI، اگر جواب نداد مدل محلی) -- اسم شهرهای ترکیه با املای فارسی («قبضه»، «آنتب») را
 * جستجوی نقشه پیدا نمی‌کند و قبلاً «داخل ایران» فرض و داخلی حساب می‌شد، و «قبضه» تنها برای مدل هم
 * مبهم است ولی «قبضه → بازرگان» نه. طرفی که مدل هم نشناخت با جستجوی جهانی نقشه (نه نشان). null یعنی معلوم نشد.
 */
@Injectable()
export class CargoTripTypeService {
  private readonly logger = new Logger(CargoTripTypeService.name);

  constructor(
    private readonly routing: RoutingService,
    private readonly redis: RedisService,
  ) {}

  async classify(origin: string, destination: string): Promise<CargoTripType | null> {
    const [from, to] = await this.locate(origin ?? '', destination ?? '');
    if (from === null || to === null) return null;
    if (from && to) return CargoTripType.Domestic;
    if (from) return CargoTripType.Export;
    if (to) return CargoTripType.Import;
    return CargoTripType.Export;
  }

  /** بار منتشرشده همیشه نوع دارد (اعلام به راننده‌های همان نوع)؛ اگر معلوم نشد داخلی، مثل بیشتر بارها. */
  async classifyListing(origin: string, destination: string): Promise<CargoTripType> {
    const tripType = await this.classify(origin, destination);
    if (tripType) return tripType;
    this.logger.warn(`Trip type of «${origin}» → «${destination}» unknown; treated as domestic`);
    return CargoTripType.Domestic;
  }

  /**
   * The Latin names of a route's ends («آنتب» → «Gaziantep, Turkey»), for finding a place abroad on the map: its
   * Persian spelling finds a shop of the same name, or a namesake in Iran. Cached per route; null where unknown.
   */
  async latinNames(origin: string, destination: string): Promise<{ origin: string | null; destination: string | null }> {
    const key = RedisService.key('placeLatinName', `${normalizePersianText(origin)} → ${normalizePersianText(destination)}`);
    const cached = await this.redis.getJson<{ origin: string | null; destination: string | null }>(key).catch(() => null);
    if (cached) return cached;
    try {
      const { content, source } = await llmAnswer({
        messages: [
          { role: 'system', content: LATIN_PROMPT },
          { role: 'user', content: `${origin || '-'} → ${destination || '-'}` },
        ],
        format: LATIN_SCHEMA,
        options: { temperature: 0 },
        tier: 'light',
        localFallback: true,
      });
      const answer = JSON.parse(content) as { origin: unknown; destination: unknown };
      const name = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
      const names = { origin: name(answer.origin), destination: name(answer.destination) };
      if (source !== 'local' && (names.origin || names.destination)) await this.redis.setJson(key, names, ROUTE_TTL_SECONDS).catch(() => undefined);
      return names;
    } catch (error) {
      this.logger.warn(`Could not ask the model for the Latin names of «${origin}» → «${destination}»: ${(error as Error).message}`);
      return { origin: null, destination: null };
    }
  }

  /** هر طرف: true داخل ایران، false خارج، null نامعلوم (یا خالی). */
  private async locate(origin: string, destination: string): Promise<[Side, Side]> {
    // undefined: در فهرست نیست و باید پرسیده شود
    const known = [origin, destination].map((place) => (!looseWords(place) ? null : isKnownIranPlace(place) ? true : undefined));
    if (!known.includes(undefined)) return known as [Side, Side];

    const key = RedisService.key('tripTypeRoute', `${normalizePersianText(origin)} → ${normalizePersianText(destination)}`);
    const cached = await this.redis.getJson<[Side, Side]>(key).catch(() => null);
    if (cached) return cached;

    let answer = await this.askModel(origin, destination, 'light');
    // اسم مبهم («قبضه» کنار یک شهر ایران) را مدل سبک گاهی نمی‌شناسد؛ همان مسیر یک بار از مدل قوی‌تر
    if (answer?.source === 'openai' && known.some((side, i) => side === undefined && answer!.sides[i] === null)) {
      answer = (await this.askModel(origin, destination, 'strong')) ?? answer;
    }
    // a side the model left unknown: the country of its Latin name («پلون» → «Pleven, Bulgaria»), asked separately
    // and steadier; the map only after that, and its answer is not cached: it finds a namesake in Iran for nearly
    // any foreign name («پلون» in Tehran), which kept a load to Bulgaria «domestic» for half a year
    let unsure = false;
    const latin = known.some((side, i) => side === undefined && (answer?.sides[i] ?? null) === null) ? await this.latinNames(origin, destination) : null;
    const sides = (await Promise.all(
      known.map(async (side, i) => {
        if (side !== undefined) return side;
        const fromModel = answer?.sides[i] ?? null;
        if (fromModel !== null) return fromModel;
        const fromLatin = latinSide(i === 0 ? latin?.origin : latin?.destination);
        if (fromLatin !== null) return fromLatin;
        unsure = true;
        return this.lookupMap(i === 0 ? origin : destination);
      }),
    )) as [Side, Side];
    // جواب مدل محلی کش نمی‌شود: اسم شهرهای ترکیه را گاهی ایران می‌داند؛ دفعه‌ی بعد OpenAI دوباره می‌پرسد
    if (!sides.includes(null) && !unsure && answer?.source !== 'local') await this.redis.setJson(key, sides, ROUTE_TTL_SECONDS).catch(() => undefined);
    return sides;
  }

  private async askModel(origin: string, destination: string, tier: 'light' | 'strong'): Promise<{ sides: [Side, Side]; source: 'openai' | 'local' } | null> {
    try {
      const { content, source } = await llmAnswer({
        messages: [
          { role: 'system', content: ROUTE_PROMPT },
          { role: 'user', content: `${origin || '-'} → ${destination || '-'}` },
        ],
        format: ROUTE_SCHEMA,
        // فقط روی مدل محلی اثر دارد: بدون فکر کردن qwen3 «ادانا» و «آنتب» را ایران می‌داند
        think: true,
        options: { temperature: 0 },
        tier,
        localFallback: true,
      });
      const answer = JSON.parse(content) as { origin_in_iran: Side; destination_in_iran: Side; origin_country: string | null; destination_country: string | null };
      this.logger.debug(`«${origin}» → «${destination}» (${source}): ${answer.origin_country ?? '?'} → ${answer.destination_country ?? '?'}`);
      const side = (value: unknown): Side => (typeof value === 'boolean' ? value : null);
      return { sides: [side(answer.origin_in_iran), side(answer.destination_in_iran)], source };
    } catch (error) {
      this.logger.warn(`Could not ask the model about «${origin}» → «${destination}»: ${(error as Error).message}`);
      return null;
    }
  }

  // فقط جستجوی جهانی؛ نشان برای هر اسم خارجی هم‌نامی در ایران پیدا می‌کند («قبضه» در تهران)
  private async lookupMap(place: string): Promise<Side> {
    return this.routing.inIranWorldwide(place).catch(() => null);
  }
}
