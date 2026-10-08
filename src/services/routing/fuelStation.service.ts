import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';

import { FuelStation } from '../../domain/entities/routing/FuelStation';
import { RedisService } from '../redis/redis.service';
import { ipv4Agent } from './http';
import { bboxOf, GeoPoint, haversineKm, inBBox, projectOnRoute, resample } from './geo';

const DEFAULT_OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// ایران (با کمی حاشیه) در ۱۲ تکه تا هر درخواست Overpass زیر محدودیت زمانش بماند.
const IRAN = { south: 25, west: 44, north: 40, east: 63.5 };
const CHUNK_ROWS = 3;
const CHUNK_COLS = 4;
const REFRESH_SECONDS = 30 * 86_400;
// تکه‌هایی که نشد (Overpass شلوغ/کند) بعد از این مدت دوباره امتحان می‌شوند.
const RETRY_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 120_000;
// جایگاه حداکثر این‌قدر از خود جاده فاصله داشته باشد تا «سر راه» حساب شود.
const MAX_OFF_ROUTE_KM = 0.8;
// دو جایگاه نزدیک‌تر از این روی مسیر احتمالاً یکی‌اند (یک جایگاه دوطرفه یا ثبت تکراری).
const DUPLICATE_KM = 0.25;

/** منطقه‌ی همگام‌سازی («ردیف-ستون») که نقطه در آن است؛ بیرون از کادر ایران null. */
export function regionOf(point: GeoPoint): string | null {
  const r = Math.floor(((point.lat - IRAN.south) / (IRAN.north - IRAN.south)) * CHUNK_ROWS);
  const c = Math.floor(((point.lng - IRAN.west) / (IRAN.east - IRAN.west)) * CHUNK_COLS);
  if (r < 0 || r >= CHUNK_ROWS || c < 0 || c >= CHUNK_COLS) return null;
  return `${r}-${c}`;
}

export interface RouteFuelStation {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  diesel: boolean | null;
  cng: boolean | null;
  // کیلومتر از مبدأ روی همین مسیر
  atKm: number;
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
 * جایگاه‌های سوخت ایران: همگام‌سازی ماهانه از OpenStreetMap (Overpass) در
 * پس‌زمینه و پیدا کردن جایگاه‌های کنار یک مسیر از روی نسخه‌ی محلی.
 */
@Injectable()
export class FuelStationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FuelStationService.name);
  private readonly overpassUrls: string[];
  private readonly userAgent: string;
  private cache?: Promise<FuelStation[]>;
  private syncing?: Promise<number>;
  private retryTimer?: NodeJS.Timeout;

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
   * بعد از بالا آمدن برنامه، در پس‌زمینه: تکه‌هایی که در ۳۰ روز گذشته
   * به‌روز نشده‌اند (یا همگام‌سازی قبلی وسطش قطع شد) دریافت می‌شوند.
   */
  onApplicationBootstrap(): void {
    void this.sync().catch((error: Error) => this.logger.warn(`Fuel station refresh failed: ${error.message}`));
  }

  onModuleDestroy(): void {
    clearTimeout(this.retryTimer);
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
        const doneKey = RedisService.key('fuelStationChunk', `${r}-${c}`);  // همان regionOf
        if (await this.redis.exists(doneKey)) {
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
          const rows = await this.fetchChunk(box);
          for (let i = 0; i < rows.length; i += 500) await this.stations.upsert(rows.slice(i, i + 500), ['id']);
          await this.redis.set(doneKey, new Date().toISOString(), REFRESH_SECONDS);
          saved += rows.length;
          this.cache = undefined;
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

  private async fetchChunk(box: { south: number; west: number; north: number; east: number }): Promise<Partial<FuelStation>[]> {
    const query = `[out:json][timeout:100];nwr["amenity"="fuel"](${box.south},${box.west},${box.north},${box.east});out center tags;`;
    let lastError: unknown;
    for (const url of this.overpassUrls) {
      try {
        const { data } = await axios.post<{ elements: OverpassElement[] }>(url, new URLSearchParams({ data: query }).toString(), {
          timeout: REQUEST_TIMEOUT_MS,
          httpsAgent: ipv4Agent,
          headers: { 'User-Agent': this.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        if (!Array.isArray(data?.elements)) throw new Error('Unexpected Overpass response.');
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
      updatedAt: new Date(),
    };
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
    const regions = new Set(resample(route, 5).points.map(regionOf).filter((region): region is string => !!region));
    let done = 0;
    try {
      for (const region of regions) {
        if (await this.redis.exists(RedisService.key('fuelStationChunk', region))) done++;
      }
    } catch (error) {
      // بدون Redis معلوم نیست کدام منطقه دریافت شده؛ جایگاه‌های موجود نشان داده
      // می‌شوند ولی هشدار «فاصله‌ی بی‌جایگاه» نه.
      this.logger.warn(`Fuel station coverage check failed: ${(error as Error).message}`);
      return 'partial';
    }
    return done === 0 ? 'none' : done === regions.size ? 'complete' : 'partial';
  }

  /** نزدیک‌ترین جایگاه‌ها به یک نقطه (فاصله‌ی مستقیم)، نزدیک‌ترین اول. */
  async near(point: GeoPoint, radiusKm: number, limit: number): Promise<(RouteFuelStation & { distanceKm: number })[]> {
    const box = bboxOf([point], radiusKm / 100);
    return (await this.all())
      .filter((station) => inBBox({ lat: station.latitude, lng: station.longitude }, box))
      .map((station) => ({
        id: station.id,
        name: station.name ?? null,
        lat: station.latitude,
        lng: station.longitude,
        diesel: station.diesel ?? null,
        cng: station.cng ?? null,
        atKm: 0,
        distanceKm: haversineKm(point, { lat: station.latitude, lng: station.longitude }),
      }))
      .filter((station) => station.distanceKm <= radiusKm)
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
      found.push({
        id: station.id,
        name: station.name ?? null,
        lat: station.latitude,
        lng: station.longitude,
        diesel: station.diesel ?? null,
        cng: station.cng ?? null,
        atKm,
      });
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
