import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { normalizePersianText } from '../../domain/helper/persianText';
import { RedisService } from '../redis/redis.service';
import { ipv4Agent } from './http';
import { leavesIran } from './iranBorder';
import { decodePolyline, encodePolyline, GeoPoint, haversineKm, maxDeviationKm, pointAtFraction, trimSpur } from './geo';

/** یک مسیر پیشنهادی بین دو نقطه. */
export interface RoutePlan {
  distanceKm: number;
  // زمان مسیریاب برای خودروی سواری؛ زمان کامیون با ضریب پروفایل سوخت حساب می‌شود
  durationMin: number;
  // polyline گوگل با دقت ۵ رقم
  polyline: string;
  // جاده‌های اصلی به ترتیب سهمشان از مسیر (مثل «۴۴»، «آزادراه تهران - قم»)
  roads: string[];
  // شهری که مسیر از میانه‌اش می‌گذرد (برای تشخیص مسیرها از هم)
  via: string | null;
}

/** ترافیک همین الان روی یک مسیر (دقیقه، زمان سواری نشان). */
export interface RouteTraffic {
  liveMin: number;
  freeMin: number;
  delayMin: number;
}

export interface DrivingDistance {
  distanceKm: number;
  durationMin: number;
}

const DAY = 86_400;
const GEOCODE_TTL = 30 * DAY;
const GEOCODE_MISS_TTL = DAY;
const ROUTE_TTL = 7 * DAY;
const DISTANCE_TTL = DAY;
// ترافیک زنده زود کهنه می‌شود
const TRAFFIC_TTL = 10 * 60;
const REQUEST_TIMEOUT_MS = 25_000;
// سیاست Nominatim عمومی: حداکثر یک درخواست در ثانیه
const NOMINATIM_GAP_MS = 1_100;

const MAX_ROUTES = 3;
// مسیر جایگزین حداکثر این‌قدر از سریع‌ترین مسیر طولانی‌تر باشد
const MAX_DETOUR_RATIO = 1.45;
// دو مسیر وقتی «متفاوت» حساب می‌شوند که جایی دست‌کم این‌قدر از هم دور شوند
const MIN_DEVIATION_KM = 15;
// نقطه‌ی عبور حداکثر این‌قدر از نزدیک‌ترین جاده دور باشد
const MAX_VIA_SNAP_M = 15_000;

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: string;
  legs: { distance: number; steps?: { distance: number; name?: string; ref?: string }[] }[];
}

interface NeshanDirection {
  routes?: {
    legs?: {
      summary?: string;
      distance?: { value: number };
      duration?: { value: number };
      steps?: { name?: string; polyline?: string; distance?: { value: number } }[];
    }[];
  }[];
}

interface Candidate {
  plan: RoutePlan;
  points: GeoPoint[];
}

interface OsrmResponse {
  code: string;
  routes?: OsrmRoute[];
  waypoints?: { distance: number }[];
}

/**
 * مکان‌یابی شهرها، مسیرهای جایگزین و فاصله‌ی رانندگی. پیش‌فرض OpenStreetMap
 * (Nominatim و OSRM، بدون کلید)؛ با NESHAN_API_KEY مکان‌یابی و مسیر از نشان
 * گرفته می‌شود و اگر نشان خطا داد به OSM برمی‌گردد. همه‌چیز در Redis کش می‌شود.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly osrmUrl: string;
  private readonly nominatimUrl: string;
  private readonly neshanKey?: string;
  private readonly userAgent: string;
  private nominatimQueue: Promise<unknown> = Promise.resolve();
  private lastNominatimAt = 0;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.osrmUrl = config.get<string>('OSRM_URL', 'https://router.project-osrm.org').replace(/\/$/, '');
    this.nominatimUrl = config.get<string>('NOMINATIM_URL', 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
    this.neshanKey = config.get<string>('NESHAN_API_KEY') || undefined;
    this.userAgent = config.get<string>('ROUTING_USER_AGENT', 'TransportBot/1.0');
  }

  //#region ----------- Geocoding -------------------------------------------------

  /**
   * مختصات یک مبدأ/مقصد متنی. متن بار آزاد است («تهران - میدان آزادی»، «انبار
   * قم»)؛ اگر کل متن پیدا نشد، تکه‌ی اول (معمولاً اسم شهر) امتحان می‌شود.
   */
  async geocode(place: string): Promise<GeoPoint | null> {
    const candidates = placeCandidates(place);
    for (const candidate of candidates) {
      const key = RedisService.key('routingGeocode', normalizePersianText(candidate));
      const cached = await this.redis.getJson<{ point: GeoPoint | null }>(key);
      if (cached) {
        if (cached.point) return cached.point;
        continue;
      }
      const point = await this.lookup(candidate);
      await this.redis.setJson(key, { point }, point ? GEOCODE_TTL : GEOCODE_MISS_TTL);
      if (point) return point;
    }
    return null;
  }

  private async lookup(place: string): Promise<GeoPoint | null> {
    if (this.neshanKey) {
      try {
        const data = await this.getJson<{ status?: string; location?: { x: number; y: number } }>(
          `https://api.neshan.org/v6/geocoding?address=${encodeURIComponent(place)}`,
          { 'Api-Key': this.neshanKey },
        );
        if (data.location && Number.isFinite(data.location.x)) return { lat: data.location.y, lng: data.location.x };
      } catch (error) {
        this.logger.warn(`Neshan geocoding failed for "${place}": ${(error as Error).message}`);
      }
    }
    try {
      const results = await this.nominatim<{ lat: string; lon: string }[]>(
        `/search?q=${encodeURIComponent(place)}&countrycodes=ir&format=jsonv2&limit=1&accept-language=fa`,
      );
      const first = results[0];
      return first ? { lat: Number(first.lat), lng: Number(first.lon) } : null;
    } catch (error) {
      this.logger.warn(`Geocoding failed for "${place}": ${(error as Error).message}`);
      return null;
    }
  }

  /** نام شهر/شهرستان نزدیک یک نقطه (برای «از طریق …»). */
  async placeName(point: GeoPoint): Promise<string | null> {
    const key = RedisService.key('routingPlace', `${point.lat.toFixed(2)},${point.lng.toFixed(2)}`);
    const cached = await this.redis.getJson<{ name: string | null }>(key);
    if (cached) return cached.name;
    let name: string | null = null;
    try {
      const data = await this.nominatim<{ address?: Record<string, string> }>(
        `/reverse?lat=${point.lat}&lon=${point.lng}&zoom=10&format=jsonv2&accept-language=fa`,
      );
      // در ایران city گاهی «دهستان …» است؛ شهرستان معنادارتر است («از طریق شاهرود»).
      const address = data.address ?? {};
      const town = [address.town, address.city].find((value) => value && !/^(دهستان|بخش)\s/.test(value));
      name = address.county || town || address.state || null;
      if (name) name = name.replace(/^(شهرستان|بخش|شهر|استان)\s+/, '');
    } catch (error) {
      this.logger.warn(`Reverse geocoding failed: ${(error as Error).message}`);
      return null;
    }
    await this.redis.setJson(key, { name }, GEOCODE_TTL);
    return name;
  }

  //#endregion

  //#region ----------- Routes ----------------------------------------------------

  /**
   * تا ۳ مسیر واقعاً متفاوت، سریع‌ترین اول. با کلید نشان مسیر اصلی از نشان
   * (بدون ترافیک تا شکل مسیر با ترافیک لحظه‌ای عوض نشود) و بقیه از OSRM.
   * OSRM عمومی برای مسیرهای طولانی معمولاً یک مسیر می‌دهد؛ مسیرهای جایگزین با
   * عبور اجباری از نقطه‌هایی در دو طرف میانه‌ی مسیر ساخته می‌شوند و فقط آن‌هایی
   * می‌مانند که جاده‌ی دیگری‌اند، دور زدن بی‌جا ندارند و خیلی طولانی‌تر نیستند.
   */
  async routes(origin: GeoPoint, destination: GeoPoint): Promise<RoutePlan[]> {
    const key = RedisService.key('routingRoutes', `${fixed(origin)};${fixed(destination)}`);
    const cached = await this.redis.getJson<RoutePlan[]>(key);
    if (cached) return cached;

    const accepted: Candidate[] = [];
    if (this.neshanKey) {
      const neshan = await this.neshanRoutes(origin, destination).catch((error: Error) => {
        this.logger.warn(`Neshan direction failed: ${error.message}`);
        return [];
      });
      for (const candidate of neshan) this.accept(accepted, candidate);
    }
    if (accepted.length < MAX_ROUTES) await this.addOsrmRoutes(origin, destination, accepted);
    if (!accepted.length) return [];

    const plans = accepted.sort((a, b) => a.plan.durationMin - b.plan.durationMin).map((candidate) => candidate.plan);
    // «از طریق …»: شهرستان میانه‌ی مسیر؛ اگر با مسیر قبلی یکی شد، جای دیگری از مسیر
    const used = new Set<string>();
    for (const plan of plans) {
      const points = decodePolyline(plan.polyline);
      for (const fraction of [0.5, 0.35, 0.65, 0.25, 0.75]) {
        const name = await this.placeName(pointAtFraction(points, fraction));
        plan.via ??= name;
        if (name && !used.has(name)) {
          plan.via = name;
          break;
        }
      }
      if (plan.via) used.add(plan.via);
    }
    await this.redis.setJson(key, plans, ROUTE_TTL);
    return plans;
  }

  /** آیا ترافیک زنده در دسترس است (فقط با کلید نشان). */
  get hasLiveTraffic(): boolean {
    return !!this.neshanKey;
  }

  /**
   * ترافیک همین الان روی یک مسیر: زمان با ترافیک زنده و بدون ترافیک نشان، با
   * عبور اجباری از دو نقطه‌ی همان مسیر تا نشان مسیر دیگری را حساب نکند.
   * ترافیک عوض می‌شود؛ فقط ۱۰ دقیقه کش.
   */
  async traffic(points: GeoPoint[]): Promise<RouteTraffic | null> {
    if (!this.neshanKey || points.length < 2) return null;
    const origin = points[0];
    const destination = points[points.length - 1];
    const waypoints = [pointAtFraction(points, 1 / 3), pointAtFraction(points, 2 / 3)];
    const key = RedisService.key('routingTraffic', [origin, ...waypoints, destination].map(fixed).join(';'));
    const cached = await this.redis.getJson<RouteTraffic>(key);
    if (cached) return cached;

    const query = `type=car&origin=${latLng(origin)}&destination=${latLng(destination)}&waypoints=${encodeURIComponent(waypoints.map(latLng).join('|'))}`;
    try {
      const [live, free] = await Promise.all([
        this.neshanDirection(`/v4/direction?${query}`),
        this.neshanDirection(`/v4/direction/no-traffic?${query}`),
      ]);
      const liveMin = totalMinutes(live.routes?.[0]);
      const freeMin = totalMinutes(free.routes?.[0]);
      if (liveMin === null || freeMin === null) return null;
      const result = { liveMin, freeMin, delayMin: Math.max(0, liveMin - freeMin) };
      await this.redis.setJson(key, result, TRAFFIC_TTL);
      return result;
    } catch (error) {
      this.logger.warn(`Neshan traffic failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** فاصله و زمان رانندگی (مثلاً از موقعیت راننده تا مبدأ بار)؛ با نشان، با ترافیک الان. */
  async drivingDistance(from: GeoPoint, to: GeoPoint): Promise<DrivingDistance | null> {
    const key = RedisService.key('routingDistance', `${from.lat.toFixed(2)},${from.lng.toFixed(2)};${fixed(to)}`);
    const cached = await this.redis.getJson<DrivingDistance>(key);
    if (cached) return cached;
    try {
      let result: DrivingDistance | null = null;
      if (this.neshanKey) {
        const route = (await this.neshanDirection(`/v4/direction?type=car&origin=${latLng(from)}&destination=${latLng(to)}`)).routes?.[0];
        const minutes = totalMinutes(route);
        if (route && minutes !== null) {
          result = { distanceKm: (route.legs ?? []).reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0) / 1000, durationMin: minutes };
        }
      }
      if (!result) {
        const route = (await this.osrm([from, to], { overview: 'false', alternatives: 'false', steps: 'false' })).routes?.[0];
        if (route) result = { distanceKm: route.distance / 1000, durationMin: route.duration / 60 };
      }
      if (!result) return null;
      await this.redis.setJson(key, result, this.neshanKey ? TRAFFIC_TTL : DISTANCE_TTL);
      return result;
    } catch (error) {
      this.logger.warn(`Driving distance failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** مسیر جایگزین وقتی قبول می‌شود که متفاوت، نه خیلی طولانی و (جز اولی) داخل ایران باشد. */
  private accept(accepted: Candidate[], candidate: Candidate): boolean {
    if (accepted.length >= MAX_ROUTES) return false;
    if (accepted.length) {
      const shortest = Math.min(...accepted.map((a) => a.plan.distanceKm));
      if (candidate.plan.distanceKm > shortest * MAX_DETOUR_RATIO) return false;
      // مسیر جایگزین از خاک همسایه (مثلاً ترکمنستان) برای بار داخلی بی‌معنی است
      if (leavesIran(candidate.points)) return false;
      if (!this.isDistinct(candidate.points, accepted.map((a) => a.points))) return false;
    }
    accepted.push(candidate);
    return true;
  }

  private async addOsrmRoutes(origin: GeoPoint, destination: GeoPoint, accepted: Candidate[]): Promise<void> {
    let primary: OsrmResponse;
    try {
      primary = await this.osrm([origin, destination], { alternatives: '3' });
    } catch (error) {
      this.logger.warn(`OSRM route failed: ${(error as Error).message}`);
      return;
    }
    for (const route of primary.routes ?? []) this.accept(accepted, osrmCandidate(route, decodePolyline(route.geometry)));
    if (!accepted.length || accepted.length >= MAX_ROUTES) return;

    const fastest = accepted[0].points;
    const vias = await Promise.all(
      this.viaCandidates(origin, destination, fastest).map((via) => this.viaRoute(origin, via, destination)),
    );
    for (const candidate of vias) {
      if (candidate) this.accept(accepted, osrmCandidate(candidate.route, candidate.points));
    }
  }

  /** نقطه‌هایی عمود بر خط مبدأ–مقصد، در دو طرف میانه‌ی مسیر سریع. */
  private viaCandidates(origin: GeoPoint, destination: GeoPoint, fastest: GeoPoint[]): GeoPoint[] {
    const straight = haversineKm(origin, destination);
    if (straight < 40) return [];
    const mid = pointAtFraction(fastest, 0.5);
    // بردار عمود در مختصات محلی کیلومتری
    const kx = 111.32 * Math.cos((mid.lat * Math.PI) / 180);
    const dx = (destination.lng - origin.lng) * kx;
    const dy = (destination.lat - origin.lat) * 110.57;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const offsets = [0.2, -0.2, 0.4, -0.4].map((f) => Math.sign(f) * Math.min(200, Math.max(25, Math.abs(f) * straight)));
    return offsets.map((km) => ({ lat: mid.lat + (ny * km) / 110.57, lng: mid.lng + (nx * km) / kx }));
  }

  private async viaRoute(
    origin: GeoPoint,
    via: GeoPoint,
    destination: GeoPoint,
  ): Promise<{ route: OsrmRoute; points: GeoPoint[] } | null> {
    try {
      const data = await this.osrm([origin, via, destination], { alternatives: 'false' });
      const route = data.routes?.[0];
      // نقطه‌ی عبور وسط کویر/کوه که جاده‌ای نزدیکش نیست مسیر واقعی نمی‌سازد
      if (!route || (data.waypoints?.[1]?.distance ?? Infinity) > MAX_VIA_SNAP_M) return null;
      // رفت‌وبرگشت تا جاده‌ی فرعیِ نزدیک نقطه‌ی عبور حذف می‌شود
      const { points, removedKm } = trimSpur(decodePolyline(route.geometry), route.legs[0].distance / 1000);
      if (!removedKm) return { route, points };
      const kept = Math.max(0, route.distance - removedKm * 1000);
      return {
        route: { ...route, distance: kept, duration: route.duration * (kept / route.distance), geometry: encodePolyline(points) },
        points,
      };
    } catch {
      return null;
    }
  }

  private isDistinct(points: GeoPoint[], others: GeoPoint[][]): boolean {
    return others.every((other) => maxDeviationKm(points, other) >= MIN_DEVIATION_KM);
  }

  private osrm(points: GeoPoint[], params: Record<string, string>): Promise<OsrmResponse> {
    const coordinates = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const query = new URLSearchParams({ overview: 'full', geometries: 'polyline', steps: 'true', ...params });
    return this.getJson<OsrmResponse>(`${this.osrmUrl}/route/v1/driving/${coordinates}?${query}`).then((data) => {
      if (data.code !== 'Ok') throw new Error(`OSRM ${data.code}`);
      return data;
    });
  }

  /** مسیر(ها)ی نشان بدون ترافیک؛ شکل دقیق از polyline گام‌ها (خط کلی نشان خیلی ساده‌شده است). */
  private async neshanRoutes(origin: GeoPoint, destination: GeoPoint): Promise<Candidate[]> {
    const data = await this.neshanDirection(
      `/v4/direction/no-traffic?type=car&origin=${latLng(origin)}&destination=${latLng(destination)}&alternative=true`,
    );
    const candidates: Candidate[] = [];
    for (const route of data.routes ?? []) {
      const legs = route.legs ?? [];
      const points: GeoPoint[] = [];
      for (const step of legs.flatMap((leg) => leg.steps ?? [])) {
        if (!step.polyline) continue;
        const part = decodePolyline(step.polyline);
        points.push(...(points.length ? part.slice(1) : part));
      }
      const minutes = totalMinutes(route);
      if (points.length < 2 || minutes === null) continue;
      const roads = new Map<string, number>();
      for (const step of legs.flatMap((leg) => leg.steps ?? [])) {
        if (step.name) roads.set(step.name, (roads.get(step.name) ?? 0) + (step.distance?.value ?? 0));
      }
      candidates.push({
        points,
        plan: {
          distanceKm: legs.reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0) / 1000,
          durationMin: minutes,
          polyline: encodePolyline(points),
          // «بزرگراه فهمیده - بزرگراه فهمیده» → «بزرگراه فهمیده»
          roads: legs[0]?.summary ? [[...new Set(legs[0].summary.split(' - ').map((part) => part.trim()))].join(' - ')] : topKeys(roads, 2),
          via: null,
        },
      });
    }
    return candidates.sort((a, b) => a.plan.durationMin - b.plan.durationMin);
  }

  private neshanDirection(path: string): Promise<NeshanDirection> {
    return this.getJson<NeshanDirection>(`https://api.neshan.org${path}`, { 'Api-Key': this.neshanKey! });
  }

  //#endregion

  //#region ----------- HTTP ------------------------------------------------------

  /** Nominatim عمومی: درخواست‌ها پشت‌سرهم با فاصله‌ی یک ثانیه. */
  private nominatim<T>(path: string): Promise<T> {
    const run = this.nominatimQueue.then(async () => {
      const wait = this.lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        return await this.getJson<T>(`${this.nominatimUrl}${path}`);
      } finally {
        this.lastNominatimAt = Date.now();
      }
    });
    this.nominatimQueue = run.catch(() => undefined);
    return run;
  }

  protected async getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const { data } = await axios.get<T>(url, {
      timeout: REQUEST_TIMEOUT_MS,
      httpsAgent: ipv4Agent,
      headers: { 'User-Agent': this.userAgent, ...headers },
    });
    return data;
  }

  //#endregion
}

/** «تهران - میدان آزادی» → ['تهران - میدان آزادی', 'تهران'] */
export function placeCandidates(place: string): string[] {
  const full = place.trim();
  const first = full.split(/[-–—،,()/|]/)[0]?.trim();
  return [...new Set([full, first].filter((value): value is string => !!value && value.length >= 2))];
}

/** جاده‌های اصلی OSRM: شماره‌ی جاده (ref) یا نامش، به ترتیب طول. */
function mainRoads(route: OsrmRoute): string[] {
  const roads = new Map<string, number>();
  for (const step of route.legs.flatMap((leg) => leg.steps ?? [])) {
    const ref = step.ref?.split(';')[0]?.trim();
    const name = ref || step.name?.trim();
    if (name) roads.set(name, (roads.get(name) ?? 0) + step.distance);
  }
  return topKeys(roads, 2);
}

function topKeys(weights: Map<string, number>, count: number): string[] {
  return [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([key]) => key);
}

const fixed = (point: GeoPoint) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
const latLng = (point: GeoPoint) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;

function totalMinutes(route: NonNullable<NeshanDirection['routes']>[number] | undefined): number | null {
  const legs = route?.legs ?? [];
  if (!legs.length) return null;
  return legs.reduce((sum, leg) => sum + (leg.duration?.value ?? 0), 0) / 60;
}

function osrmCandidate(route: OsrmRoute, points: GeoPoint[]): Candidate {
  return {
    points,
    plan: {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      polyline: route.geometry,
      roads: mainRoads(route),
      via: null,
    },
  };
}
