import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { cargoLine } from 'src/application/services/agent/tools/toolKit';
import { CargoRequest } from '../../domain/entities/notification/CargoRequest';
import { DriverLocation } from '../../domain/entities/notification/DriverLocation';
import { CargoListingStatus, CargoRequestStatus } from '../../domain/enums/notification';
import { IBotLinkRepository } from '../../domain/repositories/messengerBot/IBotLinkRepository';
import { BOT_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';
import {
  CargoRequestRepository,
  DriverLocationRepository,
} from '../../infrastructure/repositories/notification/cargoRequest.repository';
import { TripAction } from '../../domain/constants/bot/TripAction';
import { MessengerPlatform } from '../../domain/enums/messenger';
import { BotAction, BotContext } from '../messengerBot/core/botDialog';
import { MessengerBotService } from '../messengerBot/core/messengerBot.service';
import { RedisService } from '../redis/redis.service';
import { haversineKm } from '../routing/geo';
import { persianDateTime } from '../../domain/helper/persianDate';
import { CargoListingService } from './cargoListing.service';
import { CargoSearch } from './cargoSearch';
import { WhatsappDialogBridge } from './whatsappDialogBridge';
import { DriverProfileService } from '../driver/driverProfile.service';
import { NotificationsGateway } from './notifications.gateway';

export const CARGO_REQUEST_CHANGED_SOCKET_EVENT = 'cargo-request-changed';

// بار سپرده‌شده تا این مدت منتظر تأیید راننده می‌ماند
export const OFFER_TTL_MINUTES = 30;

// شرکت موقعیت تازه خواسته؛ لوکیشن بعدی راننده تا این مدت برایش فرستاده می‌شود.
const LOCATION_REQUEST_TTL_SECONDS = 2 * 60 * 60;
// سابقه‌ی موقعیت
const LIVE_LOG_GAP_MS = 2 * 60 * 1000;
const LIVE_LOG_MOVE_KM = 0.3;
const LOG_RETENTION_MS = 30 * 86_400_000;
const HISTORY_HOURS = 24;
const HISTORY_LIMIT = 300;


export interface PartyContact {
  name: string;
  phones: string[];
}

/**
 * درخواست راننده برای بارهای اعلام‌شده، قبول/رد شرکت، سفر فعال و تحویل، و
 * موقعیت راننده. هر تغییر برای طرف مقابل در همه‌ی پیام‌رسان‌هایی که وصل کرده
 * اعلان می‌شود.
 */
@Injectable()
export class CargoTripService {
  private readonly logger = new Logger(CargoTripService.name);

  constructor(
    private readonly requests: CargoRequestRepository,
    private readonly locations: DriverLocationRepository,
    private readonly listings: CargoListingService,
    private readonly bots: MessengerBotService,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
    @Inject(BOT_LINK_REPOSITORY) private readonly botLinks: IBotLinkRepository,
    private readonly whatsapp: WhatsappDialogBridge,
    private readonly profiles: DriverProfileService,
    private readonly gateway: NotificationsGateway,
  ) {}

  //#region ----------- Driver ------------------------------------------------

  /**
   * بارهای باز برای راننده همراه درخواست خودش برای هر بار (myRequest)؛ صفحه‌ی بارهای راننده و
   * ابزار agent هر دو از همین استفاده می‌کنند. matchFilters یعنی فقط بارهای جور با فیلترهای راننده.
   */
  async listOpenForDriver(
    driverUserId: string,
    options: { page: number; pageSize: number; matchFilters?: boolean } & CargoSearch,
  ) {
    const { matchFilters, ...rest } = options;
    const result = await this.listings.listOpen({ ...rest, userId: matchFilters ? driverUserId : undefined });
    const ids = result.items.map((item) => item.id);
    const mine = new Map((await this.requests.findForDriverByListings(driverUserId, ids)).map((r) => [r.listingId, r]));
    // بار سپرده‌شده به راننده‌ی دیگر: «رزرو شده» و بدون دکمه‌ی درخواست
    const reserved = new Set(
      (await this.requests.findActiveOffersForListings(ids)).filter((r) => r.driverUserId !== driverUserId).map((r) => r.listingId),
    );
    return {
      ...result,
      items: result.items.map((item) => {
        const own = mine.get(item.id);
        return {
          ...item,
          myRequest: own ? { id: own.id, status: own.status, offerExpiresAt: own.offerExpiresAt ?? null } : null,
          reserved: reserved.has(item.id),
        };
      }),
    };
  }

  async request(driverUserId: string, listingId: string): Promise<CargoRequest> {
    const listing = await this.listings.findById(listingId);
    if (!listing) throw new NotFoundException('Cargo listing not found.');
    if (listing.status !== CargoListingStatus.Open) throw new ConflictException('taken');
    if (listing.publisherUserId === driverUserId) throw new ConflictException('own');

    let request = await this.requests.findByListingAndDriver(listingId, driverUserId);
    if (request && [CargoRequestStatus.Pending, CargoRequestStatus.Offered, CargoRequestStatus.Accepted].includes(request.status)) {
      throw new ConflictException('already');
    }
    // بار به راننده‌ی دیگری سپرده شده و منتظر تأیید اوست
    if (await this.requests.findActiveOffer(listingId)) throw new ConflictException('reserved');
    if (request?.status === CargoRequestStatus.Rejected) throw new ConflictException('rejected');
    request ??= this.requests.create({ listingId, driverUserId, companyUserId: listing.publisherUserId });
    request.status = CargoRequestStatus.Pending;
    request.decidedAt = null;
    const saved = await this.requests.save(request);

    const full = (await this.requests.findById(saved.id))!;
    const driver = await this.contact(driverUserId);
    await this.notify(
      listing.publisherUserId,
      this.t('notify.newRequest', { driver: this.describe(driver), cargo: this.cargoTitle(full) }),
      [
        { id: `${TripAction.Accept}${saved.id}`, label: this.t('actions.accept'), row: 0 },
        { id: `${TripAction.Reject}${saved.id}`, label: this.t('actions.reject'), row: 0 },
        { id: `${TripAction.CompanyRequests}1`, label: this.t('actions.allRequests'), row: 1 },
      ],
    );
    return full;
  }

  async cancel(driverUserId: string, requestId: string): Promise<CargoRequest> {
    const request = await this.owned(requestId, (r) => r.driverUserId === driverUserId);
    if (request.status !== CargoRequestStatus.Pending) throw new ConflictException('notPending');
    request.status = CargoRequestStatus.Cancelled;
    await this.requests.save(request);
    return request;
  }

  driverRequests(driverUserId: string, page: number, pageSize: number) {
    return this.requests.findPageForDriver(
      driverUserId,
      Object.values(CargoRequestStatus),
      (page - 1) * pageSize,
      pageSize,
    );
  }

  async activeTrips(driverUserId: string): Promise<CargoRequest[]> {
    const [items] = await this.requests.findPageForDriver(driverUserId, [CargoRequestStatus.Accepted], 0, 10);
    return items;
  }

  /** مقصد سفر فعال یا آخرین سفر: پیش‌فرض «بار برگشتی». */
  async lastDestination(driverUserId: string): Promise<string | null> {
    return (await this.requests.findLatestTrip(driverUserId))?.listing?.destination?.trim() || null;
  }

  //#endregion

  //#region ----------- Company -----------------------------------------------

  companyRequests(companyUserId: string, page: number, pageSize: number) {
    return this.requests.findPageForCompany(companyUserId, [CargoRequestStatus.Pending], (page - 1) * pageSize, pageSize);
  }

  /** درخواست یا سفری از بارهای همین شرکت؛ null اگر مال شرکت نیست. */
  async forCompany(companyUserId: string, requestId: string): Promise<CargoRequest | null> {
    const request = await this.requests.findById(requestId);
    return request?.companyUserId === companyUserId ? request : null;
  }

  companyTrips(companyUserId: string, page: number, pageSize: number) {
    return this.requests.findPageForCompany(companyUserId, [CargoRequestStatus.Accepted], (page - 1) * pageSize, pageSize);
  }

  /**
   * قبول: سفر فعال راننده می‌شود، بار «برداشته شد» (پیام بقیه‌ی راننده‌ها
   * ویرایش می‌شود) و بقیه‌ی درخواست‌های همین بار رد می‌شوند.
   */
  async decide(companyUserId: string, requestId: string, accept: boolean): Promise<CargoRequest> {
    const request = await this.owned(requestId, (r) => r.companyUserId === companyUserId);
    if (request.status !== CargoRequestStatus.Pending) throw new ConflictException('notPending');

    if (accept && request.listing.status !== CargoListingStatus.Open) throw new ConflictException('taken');
    if (accept && (await this.requests.findActiveOffer(request.listingId))) throw new ConflictException('reserved');
    request.status = accept ? CargoRequestStatus.Accepted : CargoRequestStatus.Rejected;
    request.decidedAt = new Date();
    await this.requests.save(request);

    const company = await this.contact(companyUserId);
    const cargo = this.cargoTitle(request);
    if (accept) {
      await this.notify(request.driverUserId, this.t('notify.accepted', { cargo, company: this.describe(company) }), [
        { id: TripAction.ActiveTrip, label: this.t('actions.activeTrip'), row: 0 },
        { id: TripAction.ShareLocation, label: this.t('actions.shareLocation'), row: 0 },
      ]);
      await this.completeAssignment(request);
    } else {
      await this.notify(request.driverUserId, this.t('notify.rejected', { cargo }));
    }
    return request;
  }

  /** بار «برداشته شد»، بقیه‌ی درخواست‌های همین بار رد و به راننده‌هایشان خبر داده می‌شود. */
  private async completeAssignment(request: CargoRequest): Promise<void> {
    await this.listings.setStatus(request.companyUserId, request.listingId, CargoListingStatus.Taken);
    for (const other of await this.requests.findOtherPending(request.listingId, request.id)) {
      other.status = CargoRequestStatus.Rejected;
      other.decidedAt = new Date();
      await this.requests.save(other);
      await this.notify(other.driverUserId, this.t('notify.rejectedTaken', { cargo: this.cargoTitle(other) }));
    }
  }

  //#endregion

  //#region ----------- Company: hand a load to a driver («برداشته شد») ------

  /**
   * راننده‌هایی که شرکت می‌تواند بار را به آن‌ها بسپارد: کسانی که برای همین بار درخواست
   * داده‌اند (اول آمده، اول) و راننده‌ای که الان منتظر تأیید است.
   */
  async candidates(companyUserId: string, listingId: string) {
    const listing = await this.ownOpenListing(companyUserId, listingId);
    const pending = await this.requests.findPendingForListing(listing.id);
    const offer = await this.requests.findActiveOffer(listing.id);
    const cards = await this.profiles.cards(pending.map((r) => r.driverUserId));
    const requested = new Map(pending.map((r) => [r.driverUserId, r]));
    return {
      drivers: cards.map((card) => ({ ...card, requestedAt: requested.get(card.userId)?.createdAt ?? null })),
      offer: offer
        ? { requestId: offer.id, expiresAt: offer.offerExpiresAt, driver: (await this.profiles.cards([offer.driverUserId]))[0] ?? null }
        : null,
    };
  }

  /** راننده‌ی دیگری از سامانه با موبایل یا پلاک کامل. */
  async searchDrivers(companyUserId: string, listingId: string, query: string) {
    await this.ownOpenListing(companyUserId, listingId);
    return (await this.profiles.search(query)).filter((card) => card.userId !== companyUserId);
  }

  /**
   * شرکت بار را به یک راننده می‌سپارد؛ بار تا تأیید راننده (حداکثر OFFER_TTL_MINUTES)
   * برای بقیه «رزرو شده» است و درخواست تازه نمی‌گیرد.
   */
  async offer(companyUserId: string, listingId: string, driverUserId: string): Promise<CargoRequest> {
    const listing = await this.ownOpenListing(companyUserId, listingId);
    if (driverUserId === companyUserId) throw new ConflictException('own');
    if (!(await this.profiles.isDriver(driverUserId))) throw new ConflictException('notDriver');
    if (await this.requests.findActiveOffer(listing.id)) throw new ConflictException('reserved');

    const request =
      (await this.requests.findByListingAndDriver(listing.id, driverUserId)) ??
      this.requests.create({ listingId: listing.id, driverUserId, companyUserId });
    request.status = CargoRequestStatus.Offered;
    request.decidedAt = new Date();
    request.offerExpiresAt = new Date(Date.now() + OFFER_TTL_MINUTES * 60_000);
    const saved = await this.requests.save(request);
    const full = (await this.requests.findById(saved.id))!;

    const company = await this.contact(companyUserId);
    await this.notify(
      driverUserId,
      this.t('notify.offer', { company: this.describe(company), cargo: this.cargoTitle(full), minutes: OFFER_TTL_MINUTES }),
      [
        { id: `${TripAction.OfferYes}${saved.id}`, label: this.t('actions.offerYes'), row: 0 },
        { id: `${TripAction.OfferNo}${saved.id}`, label: this.t('actions.offerNo'), row: 0 },
      ],
    );
    this.changed(full);
    return full;
  }

  /** راننده بار سپرده‌شده را تأیید یا رد می‌کند. */
  async respondOffer(driverUserId: string, requestId: string, accept: boolean): Promise<CargoRequest> {
    const request = await this.owned(requestId, (r) => r.driverUserId === driverUserId);
    if (request.status !== CargoRequestStatus.Offered) throw new ConflictException('notOffered');
    if (request.offerExpiresAt && request.offerExpiresAt.getTime() < Date.now()) {
      await this.expire(request);
      throw new ConflictException('offerExpired');
    }

    request.status = accept ? CargoRequestStatus.Accepted : CargoRequestStatus.Declined;
    request.decidedAt = new Date();
    request.offerExpiresAt = null;
    await this.requests.save(request);

    const driver = await this.contact(driverUserId);
    const cargo = this.cargoTitle(request);
    if (accept) {
      await this.completeAssignment(request);
      await this.notify(request.companyUserId, this.t('notify.offerAccepted', { driver: this.describe(driver), cargo }), [
        { id: `${TripAction.CompanyTrips}1`, label: this.t('actions.companyTrips'), row: 0 },
      ]);
    } else {
      await this.notify(request.companyUserId, this.t('notify.offerDeclined', { driver: this.describe(driver), cargo }));
    }
    this.changed(request);
    return request;
  }

  /** پیشنهادهایی که مهلتشان گذشته: بار دوباره باز می‌شود و به هر دو طرف خبر داده می‌شود. */
  async expireOffers(now = new Date()): Promise<number> {
    const expired = await this.requests.findExpiredOffers(now);
    for (const request of expired) await this.expire(request);
    return expired.length;
  }

  private async expire(request: CargoRequest): Promise<void> {
    request.status = CargoRequestStatus.Expired;
    request.offerExpiresAt = null;
    await this.requests.save(request);
    const driver = await this.contact(request.driverUserId);
    const cargo = this.cargoTitle(request);
    await this.notify(request.companyUserId, this.t('notify.offerExpiredCompany', { driver: this.describe(driver), cargo }));
    await this.notify(request.driverUserId, this.t('notify.offerExpiredDriver', { cargo }));
    this.changed(request);
  }

  /** راننده‌ی هر بار (سپرده‌شده، در سفر یا تحویل‌شده) برای کارت «بارهای من» شرکت. */
  async assignments(listingIds: string[]) {
    const rows = await this.requests.findAssignmentsForListings(listingIds);
    const latest = new Map<string, CargoRequest>();
    for (const row of rows) if (!latest.has(row.listingId)) latest.set(row.listingId, row);
    const cards = new Map((await this.profiles.cards([...new Set([...latest.values()].map((r) => r.driverUserId))])).map((c) => [c.userId, c]));
    return new Map(
      [...latest.values()].map((r) => [
        r.listingId,
        {
          requestId: r.id,
          status: r.status,
          at: r.decidedAt ?? r.updatedAt,
          offerExpiresAt: r.offerExpiresAt ?? null,
          driver: cards.get(r.driverUserId) ?? null,
        },
      ]),
    );
  }

  private async ownOpenListing(companyUserId: string, listingId: string) {
    const listing = await this.listings.findById(listingId);
    if (!listing || listing.publisherUserId !== companyUserId) throw new NotFoundException('Cargo listing not found.');
    if (listing.status !== CargoListingStatus.Open) throw new ConflictException('taken');
    return listing;
  }

  /** پنل‌های باز شرکت و راننده بدون رفرش به‌روز شوند. */
  private changed(request: CargoRequest): void {
    const event = { requestId: request.id, listingId: request.listingId, status: request.status };
    this.gateway.sendToUser(request.companyUserId, CARGO_REQUEST_CHANGED_SOCKET_EVENT, event);
    this.gateway.sendToUser(request.driverUserId, CARGO_REQUEST_CHANGED_SOCKET_EVENT, event);
  }

  //#endregion

  //#region ----------- Both: delivery ---------------------------------------

  /** تحویل را راننده یا شرکت ثبت می‌کند؛ طرف دیگر خبردار می‌شود. */
  async deliver(userId: string, requestId: string): Promise<CargoRequest> {
    const request = await this.owned(requestId, (r) => r.driverUserId === userId || r.companyUserId === userId);
    if (request.status !== CargoRequestStatus.Accepted) throw new ConflictException('notActive');
    request.status = CargoRequestStatus.Delivered;
    request.deliveredAt = new Date();
    await this.requests.save(request);

    const byDriver = userId === request.driverUserId;
    const other = byDriver ? request.companyUserId : request.driverUserId;
    const by = await this.contact(userId);
    await this.notify(
      other,
      this.t(byDriver ? 'notify.deliveredByDriver' : 'notify.deliveredByCompany', {
        cargo: this.cargoTitle(request),
        by: this.describe(by),
      }),
    );
    return request;
  }

  //#endregion

  //#region ----------- Location ----------------------------------------------

  lastLocation(driverUserId: string): Promise<DriverLocation | null> {
    return this.locations.find(driverUserId);
  }

  /** شرکت موقعیت تازه می‌خواهد: به راننده خبر می‌دهد و لوکیشن بعدی‌اش برای شرکت می‌رود. */
  async requestLocation(companyUserId: string, requestId: string): Promise<CargoRequest> {
    const request = await this.owned(requestId, (r) => r.companyUserId === companyUserId);
    if (![CargoRequestStatus.Pending, CargoRequestStatus.Accepted].includes(request.status)) {
      throw new ConflictException('notActive');
    }
    const key = RedisService.key('locationRequest', request.driverUserId);
    const waiting = (await this.redis.getJson<string[]>(key)) ?? [];
    if (!waiting.includes(request.id)) waiting.push(request.id);
    await this.redis.setJson(key, waiting, LOCATION_REQUEST_TTL_SECONDS);

    const company = await this.contact(companyUserId);
    await this.notify(
      request.driverUserId,
      this.t('notify.locationRequested', { company: this.describe(company), cargo: this.cargoTitle(request) }),
      [{ id: TripAction.ShareLocation, label: this.t('actions.shareLocation') }],
    );
    return request;
  }

  /**
   * لوکیشن راننده ذخیره می‌شود؛ اگر شرکتی منتظرش بود (درخواست لوکیشن یا
   * سفر فعالی که تازه لوکیشن گرفت) پین برایش فرستاده می‌شود. به‌روزرسانی‌های
   * Live Location فقط ذخیره می‌شوند تا شرکت هر وقت خواست آخرینش را ببیند.
   */
  async saveLocation(
    driverUserId: string,
    point: { latitude: number; longitude: number; livePeriod?: number; edited: boolean },
  ): Promise<{ sent: number; receivedAt: Date }> {
    const receivedAt = new Date();
    const current = await this.locations.find(driverUserId);
    const liveUntil = point.livePeriod
      ? new Date(receivedAt.getTime() + point.livePeriod * 1000)
      : point.edited
        ? (current?.liveUntil ?? null)
        : null;
    await this.locations.upsert({ userId: driverUserId, latitude: point.latitude, longitude: point.longitude, liveUntil, receivedAt });
    await this.logLocation(driverUserId, point, !!liveUntil, receivedAt);
    if (point.edited) return { sent: 0, receivedAt };

    // شرکت‌هایی که موقعیت خواسته‌اند و شرکت‌هایی که با این راننده سفر فعال دارند
    const key = RedisService.key('locationRequest', driverUserId);
    const waiting = (await this.redis.getJson<string[]>(key)) ?? [];
    await this.redis.delete(key);
    const requests: CargoRequest[] = [];
    for (const requestId of waiting) {
      const request = await this.requests.findById(requestId);
      if (request && request.driverUserId === driverUserId) requests.push(request);
    }
    requests.push(...(await this.activeTrips(driverUserId)));

    const driver = await this.contact(driverUserId);
    const notified = new Set<string>();
    let sent = 0;
    for (const request of requests) {
      if (notified.has(request.companyUserId)) continue;
      notified.add(request.companyUserId);
      const text = this.t(liveUntil ? 'notify.liveLocation' : 'notify.location', {
        driver: this.describe(driver),
        cargo: this.cargoTitle(request),
        time: persianDateTime(receivedAt),
      });
      if (await this.notifyLocation(request.companyUserId, text, point.latitude, point.longitude)) sent++;
    }
    return { sent, receivedAt };
  }

  /** موقعیت‌های ۲۴ ساعت اخیر راننده (قدیمی اول) برای مسیر طی‌شده روی نقشه. */
  locationHistory(driverUserId: string, hours = HISTORY_HOURS) {
    return this.locations.history(driverUserId, new Date(Date.now() - hours * 3_600_000), HISTORY_LIMIT);
  }

  /**
   * سابقه با زمان دریافت. Live هر چند ثانیه به‌روز می‌شود؛ فقط وقتی ثبت
   * می‌شود که از آخرین ثبت ۲ دقیقه گذشته یا ۳۰۰ متر جابه‌جا شده باشد.
   */
  private async logLocation(
    driverUserId: string,
    point: { latitude: number; longitude: number; edited: boolean },
    live: boolean,
    receivedAt: Date,
  ): Promise<void> {
    if (point.edited) {
      const last = await this.locations.latestLog(driverUserId);
      const moved = last ? haversineKm({ lat: last.latitude, lng: last.longitude }, { lat: point.latitude, lng: point.longitude }) : Infinity;
      if (last && receivedAt.getTime() - last.receivedAt.getTime() < LIVE_LOG_GAP_MS && moved < LIVE_LOG_MOVE_KM) return;
    }
    await this.locations.addLog({ userId: driverUserId, latitude: point.latitude, longitude: point.longitude, live, receivedAt });
    // گاهی‌به‌گاهی قدیمی‌ها پاک شوند
    if (Math.random() < 0.05) await this.locations.pruneLogs(driverUserId, new Date(receivedAt.getTime() - LOG_RETENTION_MS));
  }

  //#endregion

  //#region ----------- Helpers -----------------------------------------------

  /** نام و شماره‌ی کاربر برای نمایش به طرف مقابل. */
  async contact(userId: string): Promise<PartyContact> {
    const draft = await this.listings.buildManualDraft(userId);
    return { name: draft.companyName || this.t('unknownName'), phones: draft.contactPhones };
  }

  describe(contact: PartyContact): string {
    return contact.phones.length ? `${contact.name} (${contact.phones.join('، ')})` : contact.name;
  }

  cargoTitle(request: CargoRequest): string {
    const listing = request.listing;
    return listing ? `${cargoLine(listing)}${listing.code ? ` · کد ${listing.code}` : ''}` : '';
  }

  private async owned(requestId: string, allowed: (request: CargoRequest) => boolean): Promise<CargoRequest> {
    const request = await this.requests.findById(requestId);
    if (!request || !allowed(request)) throw new NotFoundException('Cargo request not found.');
    return request;
  }

  /** پین نقشه برای همان کسی که در ربات یا واتساپ دکمه را زده. */
  async sendPin(ctx: BotContext, latitude: number, longitude: number): Promise<void> {
    if (ctx.platform === MessengerPlatform.Whatsapp) await this.whatsapp.sendLocation(ctx.userId, null, latitude, longitude);
    else await this.bots.sendLocation(ctx.externalUserId, latitude, longitude);
  }

  /** به همه‌ی پیام‌رسان‌هایی که کاربر وصل کرده (و واتساپ)؛ خطای یکی بقیه را متوقف نمی‌کند. */
  private async notify(userId: string, text: string, actions: BotAction[] = []): Promise<void> {
    for (const link of await this.botLinks.findAllByUserId(userId)) {
      if (!link.chatId || !this.bots.hasPlatform(link.platform)) continue;
      try {
        await this.bots.sendActionNotification(link.chatId, text, actions);
      } catch (error) {
        this.logger.warn(`Trip notification to ${userId} on ${link.platform} failed: ${(error as Error).message}`);
      }
    }
    try {
      await this.whatsapp.notify(userId, text, actions);
    } catch (error) {
      this.logger.warn(`Trip notification to ${userId} on WhatsApp failed: ${(error as Error).message}`);
    }
  }

  private async notifyLocation(userId: string, text: string, latitude: number, longitude: number): Promise<boolean> {
    let sent = false;
    for (const link of await this.botLinks.findAllByUserId(userId)) {
      if (!link.chatId || !this.bots.hasPlatform(link.platform)) continue;
      try {
        await this.bots.sendNotification(link.chatId, text);
        await this.bots.sendLocation(link.chatId, latitude, longitude);
        sent = true;
      } catch (error) {
        this.logger.warn(`Location to ${userId} on ${link.platform} failed: ${(error as Error).message}`);
      }
    }
    try {
      if (await this.whatsapp.sendLocation(userId, text, latitude, longitude)) sent = true;
    } catch (error) {
      this.logger.warn(`Location to ${userId} on WhatsApp failed: ${(error as Error).message}`);
    }
    return sent;
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`trip.${key}`, { lang: 'fa', args }) as string;
  }

  //#endregion
}
