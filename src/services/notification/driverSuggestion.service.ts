import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TripAction } from 'src/domain/constants/bot/TripAction';
import { BrokerDriverOffer } from 'src/domain/entities/company/BrokerDriverOffer';
import { CargoListingStatus } from 'src/domain/enums/notification';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { BrokerDriver, readBrokerDriver } from 'src/domain/helper/brokerDriver';
import { cargoLine } from 'src/application/services/agent/tools/toolKit';
import { BrokerAccessService } from '../company/brokerAccess.service';
import { CargoPointsService } from './cargoPoints.service';
import { CargoTripService } from './cargoTrip.service';
import { NotificationsGateway } from './notifications.gateway';
import { CargoListingRepository } from '../../infrastructure/repositories/notification/cargoListing.repository';

// a trip whose both ends are this close to the load's counts as the same route; this close, as a route near it
const SAME_KM = 30;
const NEAR_KM = 120;
// a driver's last trip ended this close to the load's origin: it is around there now
const AROUND_KM = 100;
// how long a driver may answer; the load being taken, or another driver taking it, closes it sooner
const OFFER_HOURS = 3;
// the trips looked at: a driver's routes of the last two years
const HISTORY_DAYS = 730;

export const BROKER_OFFER_SOCKET_EVENT = 'broker-offer';

/** Why a driver was picked, best first. */
type Tier = 'same' | 'near' | 'around';

interface Ranked {
  driverUserId: string;
  tier: Tier;
  trips: number;
  km: number | null;
}

const fa = (value: number) => value.toLocaleString('fa-IR');

/** Distance in km between two points in SQL (haversine; no PostGIS here). */
const km = (lat1: string, lng1: string, lat2: string, lng2: string) =>
  `(6371 * 2 * asin(sqrt(power(sin(radians(${lat2} - ${lat1}) / 2), 2) + cos(radians(${lat1})) * cos(radians(${lat2})) * power(sin(radians(${lng2} - ${lng1}) / 2), 2))))`;

/** The first word of a free-text place («تهران - انبار ۷» → «تهران»), for loads whose points were not found. */
const city = (column: string) => `split_part(trim(regexp_replace(${column}, '[-،,()/]+', ' ', 'g')), ' ', 1)`;

/**
 * «معرفی راننده» for a broker (paid, BrokerAccessService suggestion packages): for one load, the drivers who drove its
 * route most, then those who drove it less, then drivers of routes near it, then drivers whose last trip ended near
 * its origin. Each is told of it with the broker's name and the load — the broker gets no number. The first driver
 * who wants it becomes the driver of the broker's request, from its own profile, as when the broker names one
 * (CargoTripService.request with forDriver); the other drivers' offers close.
 */
@Injectable()
export class DriverSuggestionService {
  private readonly logger = new Logger(DriverSuggestionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(BrokerDriverOffer) private readonly offers: Repository<BrokerDriverOffer>,
    private readonly listings: CargoListingRepository,
    private readonly points: CargoPointsService,
    private readonly access: BrokerAccessService,
    private readonly trips: CargoTripService,
    private readonly gateway: NotificationsGateway,
  ) {}

  //#region ----------- Broker ---------------------------------------------------

  /**
   * One suggestion for a load: one credit off, the drivers found told. A suggestion that finds nobody is given back.
   * Throws ConflictException noSuggestions / taken / notPurchased / already.
   */
  async suggest(brokerUserId: string, listingId: string): Promise<{ asked: number; reasons: string[] }> {
    if (!(await this.trips.isBroker(brokerUserId))) throw new BadRequestException('معرفی راننده فقط برای حساب واسط است.');
    const listing = await this.listings.findById(listingId);
    if (!listing) throw new NotFoundException('Cargo listing not found.');
    if (listing.status !== CargoListingStatus.Open) throw new ConflictException('taken');
    if (!(await this.access.canSee(brokerUserId, listing.publisherUserId))) throw new ConflictException('notPurchased');
    // a request of the broker's still waits or runs for this load: it has its driver
    const active = await this.trips.activeRequestFor(brokerUserId, listingId);
    if (active) throw new ConflictException('already');

    await this.access.useSuggestion(brokerUserId);
    let ranked: Ranked[];
    try {
      const { suggestionDrivers } = await this.access.getPolicy();
      ranked = await this.rank(brokerUserId, listingId, suggestionDrivers);
    } catch (error) {
      await this.access.refundSuggestion(brokerUserId);
      throw error;
    }
    if (!ranked.length) {
      await this.access.refundSuggestion(brokerUserId);
      return { asked: 0, reasons: [] };
    }

    const route = `${listing.origin} ← ${listing.destination}`;
    const expiresAt = new Date(Date.now() + OFFER_HOURS * 3_600_000);
    const saved = await this.offers.save(
      ranked.map((item) => this.offers.create({ brokerUserId, listingId, driverUserId: item.driverUserId, reason: this.reason(item, route), expiresAt })),
    );
    const broker = (await this.trips.contact(brokerUserId)).name;
    const cargo = `${cargoLine(listing)}${listing.code ? ` · کد ${listing.code}` : ''}`;
    await Promise.all(saved.map((offer) => this.tell(offer, broker, cargo)));
    return { asked: saved.length, reasons: saved.map((offer) => offer.reason) };
  }

  /** Whether the broker can ask now: the admin has it on, and how many it has left. */
  async brokerState(brokerUserId: string): Promise<{ enabled: boolean; left: number }> {
    const [{ suggestionsEnabled }, left] = await Promise.all([this.access.getPolicy(), this.access.suggestionsLeft(brokerUserId)]);
    return { enabled: suggestionsEnabled, left };
  }

  /** The broker's suggestions still waiting for a driver, newest first (its open page shows them). */
  async waiting(brokerUserId: string) {
    const rows: Array<{ listingId: string; origin: string; destination: string; asked: number; declined: number; expiresAt: Date }> = await this.dataSource.query(
      `SELECT o."listingId", l.origin, l.destination, count(*)::int AS asked,
              count(*) FILTER (WHERE o.status = 'DECLINED')::int AS declined, max(o."expiresAt") AS "expiresAt"
         FROM "BrokerDriverOffer" o JOIN "CargoListing" l ON l.id = o."listingId"
        WHERE o."brokerUserId" = $1 AND o."expiresAt" > now()
          AND NOT EXISTS (SELECT 1 FROM "BrokerDriverOffer" a WHERE a."listingId" = o."listingId" AND a."brokerUserId" = o."brokerUserId" AND a.status IN ('ACCEPTED', 'CLOSED'))
        GROUP BY o."listingId", l.origin, l.destination
        ORDER BY max(o."createdAt") DESC`,
      [brokerUserId],
    );
    return rows;
  }

  //#endregion

  //#region ----------- Driver ---------------------------------------------------

  /** The offers a driver may still answer (its open panel). */
  async openFor(driverUserId: string) {
    const rows = await this.offers.find({
      where: { driverUserId, status: 'SENT' },
      relations: { listing: true, broker: true },
      order: { createdAt: 'DESC' },
    });
    const live = rows.filter((offer) => offer.expiresAt > new Date() && offer.listing?.status === CargoListingStatus.Open);
    return Promise.all(
      live.map(async (offer) => ({
        id: offer.id,
        broker: (await this.trips.contact(offer.brokerUserId)).name,
        listing: { id: offer.listing.id, code: offer.listing.code ?? null, origin: offer.listing.origin, destination: offer.listing.destination, cargoType: offer.listing.cargoType ?? null, weight: offer.listing.weight ?? null, price: offer.listing.price ?? null },
        expiresAt: offer.expiresAt,
      })),
    );
  }

  /**
   * The driver's answer. Yes: the broker's request is made for this driver from its profile (name, national code,
   * mobile, plate), unless another driver took it first or the load is gone; no: the offer closes. Returns what
   * happened, for the driver (bots, web).
   */
  async answer(driverUserId: string, offerId: string, accept: boolean): Promise<'accepted' | 'declined' | 'closed' | 'profile'> {
    const offer = await this.offers.findOne({ where: { id: offerId, driverUserId }, relations: { listing: true } });
    if (!offer) throw new NotFoundException('Offer not found.');
    const open = offer.status === 'SENT' && offer.expiresAt > new Date() && offer.listing?.status === CargoListingStatus.Open;
    if (!open) return 'closed';
    if (!accept) {
      await this.offers.update({ id: offer.id }, { status: 'DECLINED', respondedAt: new Date() });
      return 'declined';
    }
    const driver = await this.profileDriver(driverUserId);
    if (!driver) return 'profile';

    // the first yes wins: the offer is taken in one guarded statement, so two drivers at once cannot both have it
    const [taken]: [Array<{ id: string }>, number] = await this.dataSource.query(
      `UPDATE "BrokerDriverOffer" SET status = 'ACCEPTED', "respondedAt" = now()
        WHERE id = $1 AND status = 'SENT'
          AND NOT EXISTS (SELECT 1 FROM "BrokerDriverOffer" a WHERE a."listingId" = $2 AND a."brokerUserId" = $3 AND a.status = 'ACCEPTED')
        RETURNING id`,
      [offer.id, offer.listingId, offer.brokerUserId],
    );
    if (!taken.length) return 'closed';
    try {
      await this.trips.request(offer.brokerUserId, offer.listingId, null, driver, { charge: false });
    } catch (error) {
      // the load went, or the broker asked for it itself meanwhile: this yes is not the broker's driver
      await this.offers.update({ id: offer.id }, { status: 'CLOSED' });
      this.logger.warn(`Suggested driver ${driverUserId} could not take ${offer.listingId}: ${(error as Error).message}`);
      return 'closed';
    }
    await this.offers.update({ listingId: offer.listingId, brokerUserId: offer.brokerUserId, status: 'SENT' }, { status: 'CLOSED' });
    const cargo = `${offer.listing.origin} ← ${offer.listing.destination}`;
    await this.trips.notify(offer.brokerUserId, `✅ راننده‌ی معرفی‌شده برای بار ${cargo} پیدا شد: ${driver.name} (پلاک ${driver.plate}).\nدرخواست بار به نام او برای شرکت حمل‌ونقل فرستاده شد.`, [], { url: '/account/broker' });
    this.gateway.sendToUser(offer.brokerUserId, BROKER_OFFER_SOCKET_EVENT, { listingId: offer.listingId, accepted: true });
    return 'accepted';
  }

  //#endregion

  /**
   * The drivers for a load, best first: same route (most trips first), near routes, last trip ended around its origin.
   * Only drivers who work this kind of trip (domestic or abroad), have no trip running, can be told (a messenger or
   * the app), and were not asked for this load by this broker before.
   */
  async rank(brokerUserId: string, listingId: string, limit: number): Promise<Ranked[]> {
    const target = await this.points.ensure(listingId);
    const o = target?.origin;
    const d = target?.destination;
    const rows: Array<{ driverUserId: string; same: number; near: number; nearKm: number | null; aroundKm: number | null }> = await this.dataSource.query(
      `WITH target AS (
         SELECT id, "tripType", ${city('origin')} AS "originCity", ${city('destination')} AS "destinationCity" FROM "CargoListing" WHERE id = $1
       ),
       candidates AS (
         SELECT u.id FROM "User" u JOIN "DriverProfile" p ON p."userId" = u.id, target t
          WHERE u."recordStatus" = $3 AND u.id <> $2
            AND EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE ur."userId" = u.id AND r.name = 'DRIVER' AND r."recordStatus" = $3)
            AND t."tripType" = ANY(p."tripTypes")
            AND NOT EXISTS (SELECT 1 FROM "CargoRequest" a WHERE a."driverUserId" = u.id AND a.status IN ('ACCEPTED', 'OFFERED'))
            AND NOT EXISTS (SELECT 1 FROM "BrokerDriverOffer" x WHERE x."listingId" = t.id AND x."brokerUserId" = $2 AND x."driverUserId" = u.id)
            AND (EXISTS (SELECT 1 FROM "BotLink" b WHERE b."userId" = u.id)
              OR EXISTS (SELECT 1 FROM "WhatsappUserMapping" w WHERE w.userid::text = u.id::text)
              OR EXISTS (SELECT 1 FROM "WebPushSubscription" s WHERE s."userId" = u.id))
       ),
       trips AS (
         SELECT r."driverUserId" AS driver, l."originLat", l."originLng", l."destinationLat", l."destinationLng",
                ${city('l.origin')} AS "originCity", ${city('l.destination')} AS "destinationCity", COALESCE(r."decidedAt", r."createdAt") AS at
           FROM "CargoRequest" r JOIN "CargoListing" l ON l.id = r."listingId"
          WHERE r.status IN ('ACCEPTED', 'DELIVERED') AND r."forDriver" IS NULL
            AND r."createdAt" > now() - make_interval(days => $4)
            AND r."driverUserId" IN (SELECT id FROM candidates)
       ),
       measured AS (
         SELECT t.*,
                CASE WHEN $5::float8 IS NULL OR t."originLat" IS NULL THEN NULL ELSE ${km('$5::float8', '$6::float8', 't."originLat"', 't."originLng"')} END AS "fromKm",
                CASE WHEN $7::float8 IS NULL OR t."destinationLat" IS NULL THEN NULL ELSE ${km('$7::float8', '$8::float8', 't."destinationLat"', 't."destinationLng"')} END AS "toKm",
                CASE WHEN $5::float8 IS NULL OR t."destinationLat" IS NULL THEN NULL ELSE ${km('$5::float8', '$6::float8', 't."destinationLat"', 't."destinationLng"')} END AS "endKm"
           FROM trips t
       ),
       last AS (
         SELECT DISTINCT ON (driver) driver, "endKm", "destinationCity" FROM measured ORDER BY driver, at DESC
       )
       SELECT m.driver AS "driverUserId",
              count(*) FILTER (WHERE (m."fromKm" <= ${SAME_KM} AND m."toKm" <= ${SAME_KM})
                                  OR (m."fromKm" IS NULL OR m."toKm" IS NULL) AND m."originCity" = tg."originCity" AND m."destinationCity" = tg."destinationCity")::int AS same,
              count(*) FILTER (WHERE m."fromKm" <= ${NEAR_KM} AND m."toKm" <= ${NEAR_KM})::int AS near,
              min(m."fromKm" + m."toKm") FILTER (WHERE m."fromKm" <= ${NEAR_KM} AND m."toKm" <= ${NEAR_KM}) AS "nearKm",
              max(CASE WHEN l."endKm" <= ${AROUND_KM} THEN l."endKm" WHEN l."endKm" IS NULL AND l."destinationCity" = tg."originCity" THEN 0 END) AS "aroundKm"
         FROM measured m JOIN last l ON l.driver = m.driver, target tg
        GROUP BY m.driver`,
      [listingId, brokerUserId, RecordStatus.Active, HISTORY_DAYS, o?.lat ?? null, o?.lng ?? null, d?.lat ?? null, d?.lng ?? null],
    );

    const ranked: Ranked[] = [];
    for (const row of rows) {
      if (row.same > 0) ranked.push({ driverUserId: row.driverUserId, tier: 'same', trips: row.same, km: null });
      else if (row.near > 0) ranked.push({ driverUserId: row.driverUserId, tier: 'near', trips: row.near, km: row.nearKm });
      else if (row.aroundKm !== null) ranked.push({ driverUserId: row.driverUserId, tier: 'around', trips: 0, km: row.aroundKm });
    }
    const order: Record<Tier, number> = { same: 0, near: 1, around: 2 };
    ranked.sort((a, b) => order[a.tier] - order[b.tier] || b.trips - a.trips || (a.km ?? 0) - (b.km ?? 0));
    return ranked.slice(0, limit);
  }

  private reason(item: Ranked, route: string): string {
    if (item.tier === 'same') return `${fa(item.trips)} بار مسیر ${route} را رفته`;
    if (item.tier === 'near') return `${fa(item.trips)} بار مسیری نزدیک ${route} را رفته`;
    return 'آخرین سفرش به حوالی مبدأ این بار بوده';
  }

  /** The driver hears of it: the broker's name and the load, with «می‌خواهم» / «نه». */
  private async tell(offer: BrokerDriverOffer, broker: string, cargo: string): Promise<void> {
    const text = [
      `🤝 واسط «${broker}» برای این بار راننده می‌خواهد:`,
      `📦 ${cargo}`,
      `چون ${offer.reason}، به شما پیشنهاد شد.`,
      'اگر می‌خواهید این بار را ببرید «می‌خواهم» را بزنید؛ نام، کد ملی، پلاک و موبایل شما برای واسط و شرکت حمل‌ونقل فرستاده می‌شود.',
      `این پیشنهاد تا ${fa(OFFER_HOURS)} ساعت باز است.`,
    ].join('\n\n');
    await this.trips.notify(
      offer.driverUserId,
      text,
      [
        { id: `${TripAction.SuggestionYes}${offer.id}`, label: '✅ می‌خواهم', row: 0 },
        { id: `${TripAction.SuggestionNo}${offer.id}`, label: '❌ نه', row: 0 },
      ],
      { title: 'ترابوت · پیشنهاد بار از واسط', url: '/account/driver' },
    );
    this.gateway.sendToUser(offer.driverUserId, BROKER_OFFER_SOCKET_EVENT, { offerId: offer.id });
  }

  /** The driver as a broker names one (BrokerDriver), from its own profile; null when the profile lacks a part. */
  private async profileDriver(driverUserId: string): Promise<BrokerDriver | null> {
    const rows: Array<{ firstName: string | null; lastName: string | null; nationalCode: string | null; mobile: string | null; plate: string | null }> =
      await this.dataSource.query(
        `SELECT u."firstName", u."lastName", u."nationalCode", u.mobile, p.plate FROM "User" u LEFT JOIN "DriverProfile" p ON p."userId" = u.id WHERE u.id = $1`,
        [driverUserId],
      );
    const row = rows[0];
    if (!row) return null;
    const read = readBrokerDriver({
      name: [row.firstName, row.lastName].filter(Boolean).join(' '),
      nationalCode: row.nationalCode ?? '',
      mobile: row.mobile ?? '',
      plate: row.plate ?? '',
      transitPlate: '',
    });
    return 'driver' in read ? read.driver : null;
  }
}
