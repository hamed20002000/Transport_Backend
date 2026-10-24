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

// مسیر جایش عوض نمی‌شود؛ فقط جواب کامل کش می‌شود تا «نمی‌دانم» بعداً دوباره پرسیده شود
const ROUTE_TTL_SECONDS = 180 * 24 * 3600;

type Side = boolean | null;

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
    const sides = (await Promise.all(
      known.map(async (side, i) => (side !== undefined ? side : answer?.sides[i] ?? (await this.lookupMap(i === 0 ? origin : destination)))),
    )) as [Side, Side];
    // جواب مدل محلی کش نمی‌شود: اسم شهرهای ترکیه را گاهی ایران می‌داند؛ دفعه‌ی بعد OpenAI دوباره می‌پرسد
    if (!sides.includes(null) && answer?.source !== 'local') await this.redis.setJson(key, sides, ROUTE_TTL_SECONDS).catch(() => undefined);
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
