import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Between, LessThan, Repository } from 'typeorm';

import { FuelStation } from '../../domain/entities/routing/FuelStation';
import { RedisService } from '../redis/redis.service';
import { ipv4Agent } from './http';
import { BBox, bboxOf, GeoPoint, haversineKm, inBBox, projectOnRoute, resample } from './geo';

const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// ایران (با کمی حاشیه) در ۱۲ تکه تا هر درخواست Overpass زیر محدودیت زمانش بماند.
const IRAN = { south: 25, west: 44, north: 40, east: 63.5 };
const CHUNK_ROWS = 3;
const CHUNK_COLS = 4;
// منطقه‌ای که این‌قدر از دریافتش گذشته دوباره دریافت می‌شود؛ نشانِ «دریافت شده» کمی بیشتر می‌ماند
// تا وسط به‌روزرسانی، پوشش مسیر «ناقص» نشود.
const REFRESH_MS = 30 * 86_400_000;
const KEEP_SECONDS = 45 * 86_400;
// هر چند وقت سر زدن به منطقه‌های ایران که موعد به‌روزرسانی‌شان رسیده
const CHECK_MS = 6 * 60 * 60 * 1000;
// بیرون از ایران: کاشی‌های ۱°×۱° فقط وقتی مسیر یا راننده به آن‌ها برسد دریافت می‌شوند
const TILES_PER_REQUEST = 12;
// پاسخ به کاربر حداکثر این‌قدر منتظر کاشی‌های تازه می‌ماند؛ بقیه در پس‌زمینه ادامه می‌یابد
const TILE_WAIT_MS = 15_000;
// تگ‌های بنزین در OSM (هر اکتانی)
const PETROL_TAGS = ['fuel:octane_91', 'fuel:octane_92', 'fuel:octane_95', 'fuel:octane_98', 'fuel:octane_100', 'fuel:e5', 'fuel:e10', 'fuel:gasoline', 'fuel:petrol'];
// تکه‌هایی که نشد (Overpass شلوغ/کند) بعد از این مدت دوباره امتحان می‌شوند.
const RETRY_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 120_000;
// جایگاه حداکثر این‌قدر از خود جاده فاصله داشته باشد تا «سر راه» حساب شود.
const MAX_OFF_ROUTE_KM = 0.8;
// دو جایگاه نزدیک‌تر از این روی مسیر احتمالاً یکی‌اند (یک جایگاه دوطرفه یا ثبت تکراری).
const DUPLICATE_KM = 0.25;

/** منطقه‌ی همگام‌سازی نقطه: در کادر ایران «ردیف-ستون»، بیرون از آن کاشی ۱°×۱° مثل «t41_28». */
export function regionOf(point: GeoPoint): string {
  const r = Math.floor(((point.lat - IRAN.south) / (IRAN.north - IRAN.south)) * CHUNK_ROWS);
  const c = Math.floor(((point.lng - IRAN.west) / (IRAN.east - IRAN.west)) * CHUNK_COLS);
  if (r < 0 || r >= CHUNK_ROWS || c < 0 || c >= CHUNK_COLS) return tileId(Math.floor(point.lat), Math.floor(point.lng));
  return `${r}-${c}`;
}

function tileId(lat: number, lng: number): string {
  return `t${lat}_${lng}`;
}

function tileBox(id: string): BBox {
  const [lat, lng] = id.slice(1).split('_').map(Number);
  return { south: lat, west: lng, north: lat + 1, east: lng + 1 };
}

/** کاشی‌هایی که با کادر تلاقی دارند و کامل داخل کادر ایران نیستند (آن بخش را همگام‌سازی ایران دارد). */
function tilesIn(box: BBox): string[] {
  const tiles: string[] = [];
  for (let lat = Math.floor(box.south); lat <= Math.floor(box.north); lat++) {
    for (let lng = Math.floor(box.west); lng <= Math.floor(box.east); lng++) {
      const insideIran = lat >= IRAN.south && lat + 1 <= IRAN.north && lng >= IRAN.west && lng + 1 <= IRAN.east;
      if (!insideIran) tiles.push(tileId(lat, lng));
    }
  }
  return tiles;
}

function isStale(fetchedAt: string | null): boolean {
  return !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > REFRESH_MS;
}

export interface RouteFuelStation {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  diesel: boolean | null;
  cng: boolean | null;
  petrol: boolean | null;
  // کیلومتر از مبدأ روی همین مسیر
  atKm: number;
}

export const FUEL_KINDS = ['diesel', 'petrol', 'cng'] as const;
export type FuelKind = (typeof FUEL_KINDS)[number];

/**
 * جایگاه یکی از سوخت‌های خواسته‌شده را دارد. CNG فقط وقتی ثبت شده باشد. گازوئیل و بنزین وقتی
 * ثبت شده باشند، یا وقتی هیچ سوختی برای جایگاه ثبت نشده (بیشتر جایگاه‌ها هر دو را دارند و در OSM
 * کم ثبت شده). جایگاهی که سوخت دیگری برایش ثبت شده ولی این یکی نه، احتمالاً ندارد.
 */
export function sellsFuel(station: Pick<RouteFuelStation, 'diesel' | 'cng' | 'petrol'>, kinds: readonly FuelKind[]): boolean {
  const otherSold = (kind: FuelKind) => FUEL_KINDS.some((other) => other !== kind && station[other] === true);
  return kinds.some((kind) => station[kind] === true || (kind !== 'cng' && station[kind] == null && !otherSold(kind)));
}

// نوع سوختی که از اسم جایگاه پیداست («پمپ بنزین…»، «جایگاه CNG…»، «گازوییل»)؛ «گاز» تنها یعنی CNG، نه «گازوئیل»
const NAME_HINTS: Record<FuelKind, RegExp> = {
  diesel: /گازوئیل|گازوییل|گاز\s?وئیل|دیزل|diesel/i,
  petrol: /بنزین|petrol|benzin|gasoline/i,
  cng: /cng|سی[\s\u200c]?ان[\s\u200c]?جی|گاز(?![وئ\s]*(?:ئیل|ییل|وئیل))/i,
};

/**
 * سوخت‌های جایگاه: آنچه در OSM ثبت شده، و جایی که ثبت نشده آنچه از اسمش پیداست
 * (بیشتر جایگاه‌های ایران هیچ تگ سوختی ندارند ولی اسمشان «پمپ بنزین» یا «جایگاه CNG» است).
 */
export function withNameHints<T extends Pick<RouteFuelStation, 'name' | FuelKind>>(station: T): T {
  const hinted = { ...station };
  for (const kind of FUEL_KINDS) {
    if (hinted[kind] == null && station.name && NAME_HINTS[kind].test(station.name)) hinted[kind] = true;
  }
  return hinted;
}

/** بنزین: یکی از اکتان‌ها «yes»؛ فقط «no» یعنی ندارد؛ هیچ تگی یعنی نامعلوم. */
function petrolOf(tags: Record<string, string>): boolean | null {
  const values = PETROL_TAGS.map((tag) => tags[tag]).filter(Boolean);
  if (values.includes('yes')) return true;
  return values.length && values.every((value) => value === 'no') ? false : null;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  // وقتی Overpass وسط کار به محدودیت زمان/حافظه بخورد؛ elements آن‌وقت ناقص است
  remark?: string;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * جایگاه‌های سوخت از OpenStreetMap (Overpass): ایران ماهانه در پس‌زمینه، بیرون از ایران
 * کاشی‌به‌کاشی وقتی مسیری از آن بگذرد (و هر ماه دوباره)؛ پیدا کردن جایگاه‌ها از نسخه‌ی محلی.
 */
@Injectable()
export class FuelStationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FuelStationService.name);
  private readonly overpassUrls: string[];
  private readonly userAgent: string;
  private cache?: Promise<FuelStation[]>;
  private syncing?: Promise<number>;
  private retryTimer?: NodeJS.Timeout;
  private checkTimer?: NodeJS.Timeout;
  // کاشی‌هایی که الان در حال دریافت‌اند و کاشی‌هایی که نشد (تا کی دوباره امتحان نشوند)
  private readonly tileFetches = new Map<string, Promise<void>>();
  private readonly tileFailedUntil = new Map<string, number>();

  constructor(
    @InjectRepository(FuelStation) private readonly stations: Repository<FuelStation>,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    const urls = config.get<string>('OVERPASS_URLS');
    this.overpassUrls = urls ? urls.split(',').map((url) => url.trim()).filter(Boolean) : DEFAULT_OVERPASS_URLS;
    this.userAgent = config.get<string>('ROUTING_USER_AGENT', 'TransportBot/1.0');
  }

  /**
   * بعد از بالا آمدن برنامه و از آن به بعد هر ۶ ساعت، در پس‌زمینه: تکه‌هایی که در ۳۰ روز
   * گذشته به‌روز نشده‌اند (یا همگام‌سازی قبلی وسطش قطع شد) دریافت می‌شوند.
   */
  onApplicationBootstrap(): void {
    const run = () => void this.sync().catch((error: Error) => this.logger.warn(`Fuel station refresh failed: ${error.message}`));
    run();
    this.checkTimer = setInterval(run, CHECK_MS);
    this.checkTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearTimeout(this.retryTimer);
    clearInterval(this.checkTimer);
  }

  /** فقط تکه‌های قدیمی؛ تکه‌ای که نشد بقیه را متوقف نمی‌کند و ساعت بعد دوباره امتحان می‌شود. */
  sync(): Promise<number> {
    this.syncing ??= this.runSync().finally(() => (this.syncing = undefined));
    return this.syncing;
  }

  private async runSync(): Promise<number> {
    const latStep = (IRAN.north - IRAN.south) / CHUNK_ROWS;
    const lngStep = (IRAN.east - IRAN.west) / CHUNK_COLS;
    let saved = 0;
    let failed = 0;
    let skipped = 0;
    for (let r = 0; r < CHUNK_ROWS; r++) {
      for (let c = 0; c < CHUNK_COLS; c++) {
        const region = `${r}-${c}`; // همان regionOf
        if (!isStale(await this.redis.get(RedisService.key('fuelStationChunk', region)))) {
          skipped++;
          continue;
        }
        const box = {
          south: IRAN.south + r * latStep,
          north: IRAN.south + (r + 1) * latStep,
          west: IRAN.west + c * lngStep,
          east: IRAN.west + (c + 1) * lngStep,
        };
        try {
          saved += await this.refresh([{ region, box }]);
        } catch (error) {
          failed++;
          this.logger.warn(`Fuel stations chunk ${r},${c} failed: ${(error as Error).message}`);
        }
      }
    }
    if (skipped < CHUNK_ROWS * CHUNK_COLS) {
      this.logger.log(`Fuel stations synced: ${saved} saved, ${failed} region(s) failed, ${skipped} up to date.`);
    }
    if (failed) {
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => void this.sync().catch(() => undefined), RETRY_MS);
      this.retryTimer.unref?.();
    }
    return saved;
  }

  /**
   * جایگاه‌های چند منطقه با یک درخواست: ذخیره‌ی تازه‌ها، پاک کردن آن‌هایی که دیگر در نقشه
   * نیستند (بسته شده یا حذف شده‌اند) و علامت «دریافت شده» برای هر منطقه.
   */
  private async refresh(regions: { region: string; box: BBox }[]): Promise<number> {
    const startedAt = new Date();
    const rows = await this.fetchBoxes(regions.map(({ box }) => box));
    for (let i = 0; i < rows.length; i += 500) await this.stations.upsert(rows.slice(i, i + 500), ['id']);
    for (const { region, box } of regions) {
      await this.stations.delete({
        latitude: Between(box.south, box.north),
        longitude: Between(box.west, box.east),
        updatedAt: LessThan(startedAt),
      });
      await this.redis.set(RedisService.key('fuelStationChunk', region), startedAt.toISOString(), KEEP_SECONDS);
    }
    this.cache = undefined;
    return rows.length;
  }

  private async fetchBoxes(boxes: BBox[]): Promise<Partial<FuelStation>[]> {
    const parts = boxes.map((box) => `nwr["amenity"="fuel"](${box.south},${box.west},${box.north},${box.east});`).join('');
    const query = `[out:json][timeout:100];(${parts});out center tags;`;
    let lastError: unknown;
    for (const url of this.overpassUrls) {
      try {
        const { data } = await axios.post<OverpassResponse>(url, new URLSearchParams({ data: query }).toString(), {
          timeout: REQUEST_TIMEOUT_MS,
          httpsAgent: ipv4Agent,
          headers: { 'User-Agent': this.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (!Array.isArray(data?.elements)) throw new Error('Unexpected Overpass response.');
        // پاسخ ناقص نباید جایگاه‌های موجود را «حذف‌شده» نشان دهد
        if (data.remark) throw new Error(`Overpass: ${data.remark}`);
        return data.elements.map((element) => this.toStation(element)).filter((row): row is Partial<FuelStation> => !!row);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All Overpass servers failed.');
  }

  private toStation(element: OverpassElement): Partial<FuelStation> | null {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (lat === undefined || lng === undefined) return null;
    const tags = element.tags ?? {};
    const yesNo = (value?: string) => (value === 'yes' ? true : value === 'no' ? false : null);
    const name = tags['name:fa'] || tags.name || tags.brand || tags.operator || null;
    return {
      id: `${element.type[0]}${element.id}`,
      name: name ? name.slice(0, 200) : null,
      latitude: lat,
      longitude: lng,
      diesel: yesNo(tags['fuel:diesel']),
      cng: yesNo(tags['fuel:cng']),
      petrol: petrolOf(tags),
      updatedAt: new Date(),
    };
  }

  /**
   * کاشی‌های بیرون از ایران: آن‌هایی که هنوز دریافت نشده‌اند دریافت می‌شوند و تا TILE_WAIT_MS
   * منتظرشان می‌ماند؛ آن‌هایی که قدیمی شده‌اند فقط در پس‌زمینه تازه می‌شوند.
   */
  private async ensureTiles(tiles: Iterable<string>): Promise<void> {
    const waitFor = new Set<string>();
    const toFetch: string[] = [];
    for (const tile of new Set(tiles)) {
      if (this.tileFetches.has(tile)) {
        waitFor.add(tile);
        continue;
      }
      if ((this.tileFailedUntil.get(tile) ?? 0) > Date.now()) continue;
      const fetchedAt = await this.redis.get(RedisService.key('fuelStationChunk', tile));
      if (!isStale(fetchedAt)) continue;
      toFetch.push(tile);
      if (!fetchedAt) waitFor.add(tile);
    }
    for (let i = 0; i < toFetch.length; i += TILES_PER_REQUEST) {
      const batch = toFetch.slice(i, i + TILES_PER_REQUEST);
      const done = this.refresh(batch.map((region) => ({ region, box: tileBox(region) })))
        .then((saved) => this.logger.log(`Fuel stations fetched for ${batch.join(', ')}: ${saved}.`))
        .catch((error: Error) => {
          this.logger.warn(`Fuel stations for ${batch.join(', ')} failed: ${error.message}`);
          for (const tile of batch) this.tileFailedUntil.set(tile, Date.now() + RETRY_MS);
        })
        .finally(() => batch.forEach((tile) => this.tileFetches.delete(tile)));
      for (const tile of batch) this.tileFetches.set(tile, done);
    }
    const pending = [...waitFor].map((tile) => this.tileFetches.get(tile)).filter((done): done is Promise<void> => !!done);
    if (!pending.length) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all(pending), new Promise<void>((resolve) => (timer = setTimeout(resolve, TILE_WAIT_MS)))]).finally(() =>
      clearTimeout(timer),
    );
  }

  private all(): Promise<FuelStation[]> {
    this.cache ??= this.stations.find().catch((error) => {
      this.cache = undefined;
      throw error;
    });
    return this.cache;
  }

  /**
   * آیا جایگاه‌های همه‌ی منطقه‌هایی که مسیر از آن‌ها می‌گذرد دریافت شده‌اند.
   * اگر نه، «فاصله‌ی بی‌جایگاه» آن بخش واقعی نیست و نباید هشدار داد.
   */
  async coverage(route: GeoPoint[]): Promise<'none' | 'partial' | 'complete'> {
    const regions = new Set(resample(route, 5).points.map(regionOf));
    let done = 0;
    try {
      await this.ensureTiles([...regions].filter((region) => region.startsWith('t')));
      for (const region of regions) {
        // تکه‌ای که فقط با نسخه‌ی قبلی (بدون بنزین) دریافت شده هم جایگاه‌هایش را دارد
        if (
          (await this.redis.exists(RedisService.key('fuelStationChunk', region))) ||
          (await this.redis.exists(RedisService.key('fuelStationChunkV1', region)))
        )
          done++;
      }
    } catch (error) {
      // بدون Redis معلوم نیست کدام منطقه دریافت شده؛ جایگاه‌های موجود نشان داده
      // می‌شوند ولی هشدار «فاصله‌ی بی‌جایگاه» نه.
      this.logger.warn(`Fuel station coverage check failed: ${(error as Error).message}`);
      return 'partial';
    }
    return done === 0 ? 'none' : done === regions.size ? 'complete' : 'partial';
  }

  /** نزدیک‌ترین جایگاه‌ها به یک نقطه (فاصله‌ی مستقیم)، نزدیک‌ترین اول؛ kinds: فقط جایگاه‌های این سوخت‌ها. */
  async near(point: GeoPoint, radiusKm: number, limit: number, kinds?: readonly FuelKind[]): Promise<(RouteFuelStation & { distanceKm: number })[]> {
    const box = bboxOf([point], radiusKm / 100);
    await this.ensureTiles(tilesIn(box)).catch((error: Error) => this.logger.warn(`Fuel station tiles failed: ${error.message}`));
    return (await this.all())
      .filter((station) => inBBox({ lat: station.latitude, lng: station.longitude }, box))
      .map((station) =>
        withNameHints({
          id: station.id,
          name: station.name ?? null,
          lat: station.latitude,
          lng: station.longitude,
          diesel: station.diesel ?? null,
          cng: station.cng ?? null,
          petrol: station.petrol ?? null,
          atKm: 0,
          distanceKm: haversineKm(point, { lat: station.latitude, lng: station.longitude }),
        }),
      )
      .filter((station) => station.distanceKm <= radiusKm && (!kinds || sellsFuel(station, kinds)))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      // یک جایگاه که دو بار در نقشه ثبت شده (نقطه و محدوده): آنکه نام دارد بماند
      .reduce<(RouteFuelStation & { distanceKm: number })[]>((unique, station) => {
        const twin = unique.findIndex((other) => haversineKm(other, station) <= DUPLICATE_KM);
        if (twin < 0) unique.push(station);
        else if (!unique[twin].name && station.name) unique[twin] = station;
        return unique;
      }, [])
      .slice(0, limit);
  }

  /** جایگاه‌های کنار مسیر به ترتیب کیلومتر از مبدأ. */
  async alongRoute(route: GeoPoint[]): Promise<RouteFuelStation[]> {
    if (route.length < 2) return [];
    const box = bboxOf(route, 0.02);
    const candidates = (await this.all()).filter((station) => inBBox({ lat: station.latitude, lng: station.longitude }, box));
    if (!candidates.length) return [];

    // مسیر با گام ~۲۰۰ متر: هم دقیق، هم سریع روی مسیرهای هزار کیلومتری
    const sampled = resample(route, 0.2);
    const found: RouteFuelStation[] = [];
    for (const station of candidates) {
      const point = { lat: station.latitude, lng: station.longitude };
      const { distanceKm, atKm } = projectOnRoute(point, sampled.points, sampled.km);
      if (distanceKm > MAX_OFF_ROUTE_KM) continue;
      found.push(
        withNameHints({
          id: station.id,
          name: station.name ?? null,
          lat: station.latitude,
          lng: station.longitude,
          diesel: station.diesel ?? null,
          cng: station.cng ?? null,
          petrol: station.petrol ?? null,
          atKm,
        }),
      );
    }
    found.sort((a, b) => a.atKm - b.atKm);
    const unique: RouteFuelStation[] = [];
    for (const station of found) {
      const last = unique[unique.length - 1];
      if (last && station.atKm - last.atKm <= DUPLICATE_KM) {
        // از دو ثبت یک جایگاه، آنکه اطلاعات بیشتری دارد بماند
        if (!last.name && station.name) unique[unique.length - 1] = station;
        continue;
      }
      unique.push(station);
    }
    return unique;
  }
}
