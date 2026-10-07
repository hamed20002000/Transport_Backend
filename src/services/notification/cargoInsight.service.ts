import { Injectable, Logger } from '@nestjs/common';

import { CargoListing } from '../../domain/entities/notification/CargoListing';
import { estimateFuelLiters, FuelProfile, fuelProfileFor } from '../routing/fuelProfile';
import { RouteFuelStation, FuelStationService } from '../routing/fuelStation.service';
import { decodePolyline, GeoPoint } from '../routing/geo';
import { placeCandidates, RoutingService } from '../routing/routing.service';
import { CargoListingService } from './cargoListing.service';
import { CargoTripService } from './cargoTrip.service';

// موقعیت قدیمی‌تر از این برای «فاصله‌ی شما تا مبدأ» استفاده نمی‌شود
const DRIVER_LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type TrafficLevel = 'smooth' | 'moderate' | 'heavy';

export interface CargoRouteOption {
  distanceKm: number;
  // زمان رانندگی کامیون (زمان بدون ترافیک × ضریب نوع ماشین + تأخیر ترافیک الان)
  truckMinutes: number;
  // ترافیک همین الان (فقط با کلید نشان)
  traffic: { delayMin: number; level: TrafficLevel } | null;
  fuelLiters: number;
  roads: string[];
  via: string | null;
  points: GeoPoint[];
}

export interface CargoInsight {
  listing: CargoListing;
  originPoint: GeoPoint | null;
  destinationPoint: GeoPoint | null;
  profile: FuelProfile;
  routes: CargoRouteOption[];
  // بارهای باز از مقصد این بار؛ toOrigin = همان‌هایی که به مبدأ همین بار برمی‌گردند
  returnLoads: { fromDestination: number; toOrigin: number };
  driver: { distanceKm: number; durationMin: number; locatedAt: Date } | null;
}

export interface RouteFuelSummary {
  stations: RouteFuelStation[];
  // بیشترین فاصله‌ی بی‌جایگاه روی مسیر (از مبدأ تا اولین، بین دو جایگاه، تا مقصد)؛
  // فقط وقتی جایگاه‌های همه‌ی منطقه‌های مسیر دریافت شده
  longestGap: { fromKm: number; toKm: number } | null;
  // none: هنوز چیزی دریافت نشده، partial: بخشی از مسیر هنوز نه
  coverage: 'none' | 'partial' | 'complete';
}

/**
 * آنچه راننده برای تصمیم درباره‌ی یک بار لازم دارد: مسیرهای مختلف با
 * مسافت، زمان و سوخت، جایگاه‌های سوخت هر مسیر، بار برگشتی از مقصد و فاصله‌ی
 * خودش تا مبدأ.
 */
@Injectable()
export class CargoInsightService {
  private readonly logger = new Logger(CargoInsightService.name);

  constructor(
    private readonly listings: CargoListingService,
    private readonly routing: RoutingService,
    private readonly fuelStations: FuelStationService,
    private readonly trips: CargoTripService,
  ) {}

  async build(listingId: string, driverUserId?: string): Promise<CargoInsight | null> {
    const listing = await this.listings.findById(listingId);
    if (!listing) return null;

    const [originPoint, destinationPoint, returnLoads] = await Promise.all([
      this.routing.geocode(listing.origin),
      this.routing.geocode(listing.destination),
      this.returnLoads(listing),
    ]);
    const profile = fuelProfileFor(listing.vehicleType);

    let routes: CargoRouteOption[] = [];
    if (originPoint && destinationPoint) {
      const plans = await this.routing.routes(originPoint, destinationPoint);
      routes = await Promise.all(
        plans.map(async (plan) => {
          const points = decodePolyline(plan.polyline);
          const live = await this.routing.traffic(points);
          const traffic = live ? { delayMin: live.delayMin, level: trafficLevel(live.liveMin, live.freeMin) } : null;
          // با ترافیک، زمان پایه‌ی همه‌ی مسیرها از نشان است تا مقایسه‌ی مسیرها منصفانه باشد
          // (مسیرهای جایگزین از OSRM با مدل سرعت دیگری آمده‌اند).
          const baseMin = live?.freeMin ?? plan.durationMin;
          return {
            distanceKm: plan.distanceKm,
            truckMinutes: baseMin * profile.durationFactor + (traffic?.delayMin ?? 0),
            traffic,
            fuelLiters: estimateFuelLiters(plan.distanceKm, profile),
            roads: plan.roads,
            via: plan.via,
            points,
          };
        }),
      );
    }

    let driver: CargoInsight['driver'] = null;
    if (driverUserId && originPoint) {
      const location = await this.trips.lastLocation(driverUserId);
      if (location && Date.now() - location.updatedAt.getTime() < DRIVER_LOCATION_MAX_AGE_MS) {
        const distance = await this.routing.drivingDistance({ lat: location.latitude, lng: location.longitude }, originPoint);
        if (distance) driver = { ...distance, locatedAt: location.updatedAt };
      }
    }

    return { listing, originPoint, destinationPoint, profile, routes, returnLoads, driver };
  }

  /** مختصات مبدأ و مقصد بار (کش‌شده؛ برای نقشه‌ی موقعیت راننده). */
  async places(listing: CargoListing | null | undefined): Promise<{ origin: GeoPoint | null; destination: GeoPoint | null }> {
    if (!listing) return { origin: null, destination: null };
    const [origin, destination] = await Promise.all([
      this.routing.geocode(listing.origin).catch(() => null),
      this.routing.geocode(listing.destination).catch(() => null),
    ]);
    return { origin, destination };
  }

  /** جایگاه‌های سوخت کنار یک مسیر و طولانی‌ترین فاصله‌ی بی‌جایگاه. */
  async fuelAlong(route: CargoRouteOption): Promise<RouteFuelSummary> {
    const coverage = await this.fuelStations.coverage(route.points);
    const stations = coverage === 'none' ? [] : await this.fuelStations.alongRoute(route.points);
    const marks = [0, ...stations.map((s) => s.atKm), route.distanceKm];
    let longestGap: RouteFuelSummary['longestGap'] = null;
    if (coverage === 'complete') {
      for (let i = 1; i < marks.length; i++) {
        if (!longestGap || marks[i] - marks[i - 1] > longestGap.toKm - longestGap.fromKm) {
          longestGap = { fromKm: marks[i - 1], toKm: marks[i] };
        }
      }
    }
    return { stations, longestGap, coverage };
  }

  /** بارهای باز از مقصد این بار (اول آن‌هایی که به مبدأش برمی‌گردند). */
  async returnLoadList(listing: CargoListing, page: number, pageSize: number) {
    const destination = core(listing.destination);
    const origin = core(listing.origin);
    const [back, all] = await Promise.all([
      this.listings.listOpen({ page: 1, pageSize: 1000, origin: destination, destination: origin }),
      this.listings.listOpen({ page: 1, pageSize: 1000, origin: destination }),
    ]);
    const backIds = new Set(back.items.map((item) => item.id));
    const ordered = [...back.items, ...all.items.filter((item) => !backIds.has(item.id))].filter((item) => item.id !== listing.id);
    return {
      items: ordered.slice((page - 1) * pageSize, page * pageSize).map((item) => ({ ...item, toOrigin: backIds.has(item.id) })),
      total: ordered.length,
    };
  }

  private async returnLoads(listing: CargoListing): Promise<CargoInsight['returnLoads']> {
    try {
      const destination = core(listing.destination);
      const [all, back] = await Promise.all([
        this.listings.listOpen({ page: 1, pageSize: 1, origin: destination }),
        this.listings.listOpen({ page: 1, pageSize: 1, origin: destination, destination: core(listing.origin) }),
      ]);
      return { fromDestination: all.total, toOrigin: back.total };
    } catch (error) {
      this.logger.warn(`Return loads failed for ${listing.id}: ${(error as Error).message}`);
      return { fromDestination: 0, toOrigin: 0 };
    }
  }
}

/**
 * سطح ترافیک از نسبت زمان الان به زمان بدون ترافیک و خود تأخیر (در مسیر
 * هزار کیلومتری ۱۰٪ یعنی یک ساعت، پس تأخیر مطلق هم مهم است).
 */
export function trafficLevel(liveMin: number, freeMin: number): TrafficLevel {
  const delay = liveMin - freeMin;
  const ratio = freeMin > 0 ? liveMin / freeMin : 1;
  if (ratio >= 1.3 || delay >= 45) return 'heavy';
  if (ratio >= 1.1 || delay >= 15) return 'moderate';
  return 'smooth';
}

/** «مشهد - بلوار وکیل‌آباد» → «مشهد»: برای پیدا کردن بارهای همان شهر. */
function core(place: string): string {
  return placeCandidates(place).at(-1) ?? place;
}
