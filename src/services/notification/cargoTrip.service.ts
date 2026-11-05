import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { cargoLine, fa } from 'src/application/services/agent/tools/toolKit';
import { BrokerDriver, BrokerDriverField, brokerCommission, brokerDriverIdentity, brokerDriverLine, fareAmount, readBrokerDriver } from 'src/domain/helper/brokerDriver';
import { BrokerPayModel, TripFareStage } from 'src/domain/enums/tripFare';
import { brokerEarning, fareDefaultsFromListing, fareLine, type TripFareInput, type TripFareValues } from 'src/domain/helper/tripFare';
import { TripFareForm, TripFareService } from './tripFare.service';
import { CargoRequest } from '../../domain/entities/notification/CargoRequest';
import { DriverLocation } from '../../domain/entities/notification/DriverLocation';
import { CargoListingStatus, CargoRequestStatus, CargoTripType } from '../../domain/enums/notification';
import { IBotLinkRepository } from '../../domain/repositories/messengerBot/IBotLinkRepository';
import { BOT_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';
import {
  CargoRequestRepository,
  DriverLocationRepository,
  type DriverHistoryFilters,
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
import { BrokerAccessService, BrokerBlock } from '../company/brokerAccess.service';
import { sendThroughOne } from './messengerOrder';
import { LoadBorderService } from './loadBorder.service';
import { driverRequestFieldsOn } from 'src/domain/helper/driverVerification';
import { NotificationsGateway } from './notifications.gateway';
import { UsageChannel } from 'src/domain/entities/analytics/usageChannel';
import { WebPushService } from './webPush.service';

export const CARGO_REQUEST_CHANGED_SOCKET_EVENT = 'cargo-request-changed';
// موقعیت تازه‌ی راننده‌ای که سفر فعال دارد، برای صفحه‌ی «سفرها»ی باز شرکت (Live Location هم)
export const TRIP_LOCATION_SOCKET_EVENT = 'trip-location';

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

/** چند روز بعد از شروع سفر بی‌تحویل، یادآوری «تحویل داده شد؟» (TRIP_DELIVERY_REMINDER_DAYS، پیش‌فرض ۳). */
export const deliveryReminderDays = () => Number(process.env.TRIP_DELIVERY_REMINDER_DAYS) || 3;

/**
 * درخواست راننده برای بارهای اعلام‌شده، قبول/رد شرکت، سفر فعال و تحویل، و
 * موقعیت راننده. هر تغییر برای طرف مقابل در همه‌ی پیام‌رسان‌هایی که وصل کرده
 * اعلان می‌شود.
 */
/** The web page a trip notification opens: the one its buttons lead to in the bots. */
function pushUrl(actions: BotAction[]): string {
  const has = (...prefixes: string[]) => actions.some((action) => prefixes.some((prefix) => action.id.startsWith(prefix)));
  if (has(TripAction.Accept, TripAction.Reject, TripAction.CompanyRequests)) return '/account/company/requests';
  if (has(TripAction.CompanyTrips, TripAction.RejectDelivery, TripAction.Location)) return '/account/company/trips';
  if (has(TripAction.OfferYes, TripAction.OfferNo)) return '/account/driver/requests';
  if (has(TripAction.ActiveTrip, TripAction.ShareLocation)) return '/account/driver/trip';
  return '/';
}

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
    @Optional() private readonly push?: WebPushService,
    @Optional() private readonly brokerAccess?: BrokerAccessService,
    @Optional() private readonly borders?: LoadBorderService,
    // the fare and weight the company records when it closes the deal and at delivery (TripFare)
    @Optional() private readonly fares?: TripFareService,
  ) {}

  /** Companies whose loads this user sees: null for all (a driver, or nothing sold to brokers); a broker gets what it bought. */
  visiblePublishers(userId: string): Promise<string[] | null> {
    return this.brokerAccess ? this.brokerAccess.visiblePublishers(userId) : Promise.resolve(null);
  }

  /** A broker with no load requests left (packages used up); false for drivers. */
  outOfRequests(userId: string): Promise<boolean> {
    return this.brokerAccess ? this.brokerAccess.outOfRequests(userId) : Promise.resolve(false);
  }

  /** Why a broker sees no loads (no companies picked); null when nothing keeps it (and for others). */
  brokerBlocked(userId: string): Promise<BrokerBlock | null> {
    return this.brokerAccess ? this.brokerAccess.blocked(userId) : Promise.resolve(null);
  }

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
    // هر راننده فقط بارهای نوع خودش (داخلی، صادراتی، وارداتی)
    const tripTypes = await this.profiles.tripTypesOf(driverUserId);
    const publisherUserIds = await this.visiblePublishers(driverUserId);
    const result = await this.listings.listOpen({ ...rest, tripTypes, publisherUserIds, userId: matchFilters ? driverUserId : undefined });
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

  /** source: where the request was made (the app, a browser, a messenger, the assistant), for the admin's figures. */
  /**
   * forDriver: a broker's request is for a driver it names (BrokerDriver), required from a broker and kept with the
   * request with this request's details (company, fare, exit border, referrer); a driver's own request ignores it and
   * needs those of its profile instead (DriverProfileService.missingForRequest). exitBorder: the border picked for an
   * export or import load (LoadBorderService), required of both.
   */
  async request(
    driverUserId: string,
    listingId: string,
    source: UsageChannel | null = null,
    forDriver?: Partial<Record<BrokerDriverField, unknown>> | null,
    exitBorder?: string | null,
  ): Promise<CargoRequest> {
    const broker = await this.isBroker(driverUserId);
    let driverFor: BrokerDriver | null = null;
    if (broker) {
      const read = readBrokerDriver(forDriver);
      if ('error' in read) throw new BadRequestException(read.error);
      driverFor = read.driver;
    } else {
      // a driver's own request: its company and fare come from its profile and must be filled first
      const missing = driverRequestFieldsOn() ? await this.profiles.missingForRequest(driverUserId) : [];
      if (missing.length) throw new BadRequestException(`برای درخواست بار اول در پروفایل راننده این‌ها را پر کنید: ${missing.join('، ')}.`);
    }
    const listing = await this.listings.findById(listingId);
    if (!listing) throw new NotFoundException('Cargo listing not found.');
    if (listing.status !== CargoListingStatus.Open) throw new ConflictException('taken');
    if (listing.publisherUserId === driverUserId) throw new ConflictException('own');
    // a broker requests only the loads of the companies it bought
    if (this.brokerAccess && !(await this.brokerAccess.canSee(driverUserId, listing.publisherUserId))) throw new ConflictException('notPurchased');
    const border = await this.pickedBorder(listing, exitBorder);

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
    request.source = source;
    request.forDriver = driverFor;
    request.exitBorder = border;
    // a broker's packages count its requests (noCredit); one not saved is given back
    const charged = this.brokerAccess ? await this.brokerAccess.useRequest(driverUserId) : false;
    let saved: CargoRequest;
    try {
      saved = await this.requests.save(request);
    } catch (error) {
      if (charged) await this.brokerAccess!.refundRequest(driverUserId);
      throw error;
    }

    const full = (await this.requests.findById(saved.id))!;
    const driver = await this.contact(driverUserId);
    const text = this.t(broker ? 'notify.newBrokerRequest' : 'notify.newRequest', {
      driver: this.describe(driver),
      cargo: this.cargoTitle(full),
      forDriver: driverFor ? brokerDriverLine(driverFor) : '',
      border: border ? `\n🛂 ${border}` : '',
    });
    this.changed(full, { type: 'newRequest', text });
    await this.notify(
      listing.publisherUserId,
      text,
      [
        { id: `${TripAction.Accept}${saved.id}`, label: this.t('actions.accept'), row: 0 },
        { id: `${TripAction.Reject}${saved.id}`, label: this.t('actions.reject'), row: 0 },
        { id: `${TripAction.CompanyRequests}1`, label: this.t('actions.allRequests'), row: 1 },
      ],
    );
    return full;
  }

  /** The border options of a load for the request form (none for a domestic one). */
  async borderChoices(listingId: string) {
    const listing = await this.listings.findById(listingId);
    if (!listing) throw new NotFoundException('Cargo listing not found.');
    return this.borders ? this.borders.choices(listing) : { needed: false, label: '', options: [] };
  }

  /** The border given for an export or import load, as one of the borders; refused with the options when missing. */
  private async pickedBorder(listing: { tripType: CargoTripType; origin: string; destination: string }, given?: string | null): Promise<string | null> {
    if (!this.borders) return null;
    const choice = await this.borders.choices(listing);
    if (!choice.needed) return null;
    const name = LoadBorderService.named(given);
    if (!name) throw new BadRequestException(`${choice.label} را انتخاب کنید: ${choice.options.join('، ')}.`);
    return name;
  }

  async cancel(driverUserId: string, requestId: string): Promise<CargoRequest> {
    const request = await this.owned(requestId, (r) => r.driverUserId === driverUserId);
    if (request.status !== CargoRequestStatus.Pending) throw new ConflictException('notPending');
    request.status = CargoRequestStatus.Cancelled;
    await this.requests.save(request);

    // like a new request: the company's open panel updates and it hears about it right away
    const full = (await this.requests.findById(request.id))!;
    const key = (await this.isBroker(driverUserId)) ? 'notify.brokerRequestCancelled' : 'notify.requestCancelled';
    const text = this.t(key, { driver: this.describe(await this.contact(driverUserId)), cargo: this.cargoTitle(full) });
    this.changed(full, { type: 'requestCancelled', text });
    await this.notify(full.companyUserId, text, [{ id: `${TripAction.CompanyRequests}1`, label: this.t('actions.allRequests'), row: 0 }]);
    return full;
  }

  /** «سفرهای رفته»: بارهای تحویل‌شده‌ی راننده با فیلترها، شمار هر نوع حمل و شرکت‌هایی که برایشان بار برده. */
  async driverHistory(driverUserId: string, filters: DriverHistoryFilters, page: number, pageSize: number) {
    const [[items, total], byTripType, companies] = await Promise.all([
      this.requests.findDeliveredForDriver(driverUserId, filters, (page - 1) * pageSize, pageSize),
      this.requests.countDeliveredByTripType(driverUserId, filters),
      this.requests.deliveredCompanies(driverUserId),
    ]);
    return { items, total, byTripType, companies };
  }

  // status: only that state (the driver home counts delivered and pending from the total)
  /** The user's request for this load that still waits or runs, if any. */
  async activeRequestFor(userId: string, listingId: string): Promise<CargoRequest | null> {
    const request = await this.requests.findByListingAndDriver(listingId, userId);
    return request && [CargoRequestStatus.Pending, CargoRequestStatus.Offered, CargoRequestStatus.Accepted].includes(request.status) ? request : null;
  }

  /** A broker's drivers from its earlier requests, to pick one again instead of typing it. */
  recentBrokerDrivers(brokerUserId: string, limit = 8): Promise<BrokerDriver[]> {
    // who the driver is; the details are the request's own and asked again
    return this.requests.recentBrokerDrivers(brokerUserId, limit).then((drivers) => drivers.map(brokerDriverIdentity));
  }

  driverRequests(driverUserId: string, page: number, pageSize: number, status?: CargoRequestStatus) {
    return this.requests.findPageForDriver(
      driverUserId,
      status ? [status] : Object.values(CargoRequestStatus),
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

  /** درخواست‌های در انتظار بارهای شرکت برای پنل وب، اول‌آمده اول، با کارت راننده (نام، خودرو، عکس). */
  async companyRequestViews(companyUserId: string, page: number, pageSize: number) {
    const [items, total] = await this.companyRequests(companyUserId, page, pageSize);
    const cards = await this.profiles.cards([...new Set(items.map((item) => item.driverUserId))]);
    const cardOf = new Map(cards.map((card) => [card.userId, card]));
    const forDriver = await this.forDriverViews(companyUserId, items);
    return {
      total,
      page,
      pageSize,
      items: items.map((item) => ({
        requestId: item.id,
        requestedAt: item.createdAt,
        cargo: item.listing
          ? {
              id: item.listing.id,
              code: item.listing.code ?? null,
              origin: item.listing.origin,
              destination: item.listing.destination,
              cargoType: item.listing.cargoType ?? null,
              weight: item.listing.weight ?? null,
              vehicleType: item.listing.vehicleType ?? null,
              price: item.listing.price ?? null,
            }
          : null,
        driver: cardOf.get(item.driverUserId) ?? null,
        forDriver: forDriver(item),
        exitBorder: item.exitBorder ?? item.forDriver?.exitBorder ?? null,
      })),
    };
  }

  /**
   * The driver of each broker's request, and whether the company may invite it: not when it is one of the company's
   * drivers already.
   */
  private async forDriverViews(companyUserId: string, items: CargoRequest[]) {
    const mobiles = [...new Set(items.flatMap((item) => (item.forDriver ? [item.forDriver.mobile] : [])))];
    const known = mobiles.length ? await this.profiles.companyDriverMobiles(companyUserId, mobiles) : new Set<string>();
    return (item: CargoRequest) => (item.forDriver ? { ...item.forDriver, companyDriver: known.has(item.forDriver.mobile) } : null);
  }

  countCompanyRequests(companyUserId: string): Promise<number> {
    return this.requests.countPendingForCompany(companyUserId);
  }

  pendingRequestCounts(listingIds: string[]): Promise<Map<string, number>> {
    return this.requests.countPendingByListings(listingIds);
  }

  /** درخواست یا سفری از بارهای همین شرکت؛ null اگر مال شرکت نیست. */
  async forCompany(companyUserId: string, requestId: string): Promise<CargoRequest | null> {
    const request = await this.requests.findById(requestId);
    return request?.companyUserId === companyUserId ? request : null;
  }

  /** سفرهای فعال شرکت، جدیدترین سفر اول. */
  companyTrips(companyUserId: string, page: number, pageSize: number) {
    return this.requests.findPageForCompany(companyUserId, [CargoRequestStatus.Accepted], (page - 1) * pageSize, pageSize, 'started');
  }

  /** سفرهای فعال شرکت برای پنل وب: بار، راننده و آخرین موقعیتش. */
  async companyTripViews(companyUserId: string, page: number, pageSize: number) {
    const [items, total] = await this.companyTrips(companyUserId, page, pageSize);
    const driverIds = [...new Set(items.map((item) => item.driverUserId))];
    const [cards, locations] = await Promise.all([
      this.profiles.cards(driverIds),
      Promise.all(driverIds.map(async (id) => [id, await this.lastLocation(id)] as const)),
    ]);
    const cardOf = new Map(cards.map((card) => [card.userId, card]));
    const locationOf = new Map(locations);
    const forDriver = await this.forDriverViews(companyUserId, items);
    const fares = await this.fares?.stagesOf(items.map((item) => item.id));
    return {
      total,
      page,
      pageSize,
      items: items.map((item) => {
        const location = locationOf.get(item.driverUserId);
        return {
          requestId: item.id,
          startedAt: item.decidedAt ?? item.updatedAt,
          deliveryRemindedAt: item.deliveryRemindedAt ?? null,
          // راننده تحویل را اعلام کرده و منتظر تأیید شرکت است
          deliveryReportedAt: item.deliveryReportedAt ?? null,
          cargo: item.listing
            ? {
                id: item.listing.id,
                code: item.listing.code ?? null,
                origin: item.listing.origin,
                destination: item.listing.destination,
                cargoType: item.listing.cargoType ?? null,
                weight: item.listing.weight ?? null,
                vehicleType: item.listing.vehicleType ?? null,
                price: item.listing.price ?? null,
              }
            : null,
          driver: cardOf.get(item.driverUserId) ?? null,
          forDriver: forDriver(item),
          exitBorder: item.exitBorder ?? item.forDriver?.exitBorder ?? null,
          brokerPayModel: item.forDriver ? (item.brokerPayModel ?? BrokerPayModel.Commission) : null,
          // the agreed fare, shown on the card and prefilled in the delivery form
          fare: fares?.get(item.id) ?? { agreed: null, delivered: null },
          location: location
            ? { latitude: location.latitude, longitude: location.longitude, receivedAt: location.receivedAt, liveUntil: location.liveUntil ?? null }
            : null,
        };
      }),
    };
  }

  /** سفرهای فعال شرکت که بیش از days روز است تحویلشان ثبت نشده (بنر یادآوری پنل وب). */
  async overdueTrips(companyUserId: string, days = deliveryReminderDays()): Promise<{ count: number; days: number }> {
    const count = await this.requests.countTripsStartedBefore(companyUserId, new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    return { count, days };
  }

  /**
   * «تحویل داده شد؟»: سفری که days روز از شروعش (یا از یادآوری قبلی) گذشته و تحویلش ثبت نشده؛
   * به شرکت با دکمه‌ی ثبت تحویل خبر داده می‌شود و هر days روز تکرار می‌شود.
   */
  async remindDeliveries(days: number, now = new Date()): Promise<number> {
    const due = await this.requests.findTripsDueDeliveryReminder(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
    for (const request of due) {
      request.deliveryRemindedAt = now;
      await this.requests.save(request);
      const driver = await this.contact(request.driverUserId);
      // راننده تحویل را اعلام کرده: یادآوری تأیید، نه پرسش «تحویل شد؟»
      const reported = !!request.deliveryReportedAt;
      const text = this.t(reported ? 'notify.confirmReminder' : 'notify.deliveryReminder', {
        driver: this.describe(driver),
        cargo: this.cargoTitle(request),
        days: fa(days),
      });
      // پنل وب باز: همان یادآوری به شکل اعلان (بنر سفرهای بی‌تحویل هم با همین رویداد به‌روز می‌شود)
      this.changed(request, { type: 'deliveryReminder', text });
      await this.notify(
        request.companyUserId,
        text,
        [
          { id: `${TripAction.Deliver}${request.id}`, label: this.t(reported ? 'actions.confirmDelivery' : 'actions.markDelivered'), row: 0 },
          { id: `${TripAction.CompanyTrips}1`, label: this.t('actions.companyTrips'), row: 1 },
        ],
      );
    }
    return due.length;
  }

  /**
   * قبول: سفر فعال راننده می‌شود، بار «برداشته شد» (پیام بقیه‌ی راننده‌ها
   * ویرایش می‌شود) و بقیه‌ی درخواست‌های همین بار رد می‌شوند.
   * deal (accept only): the fare and weight agreed (TripFare AGREED), required; for a broker's request also how the
   * broker is paid (BrokerPayModel; the company's last pick when left out).
   */
  async decide(
    companyUserId: string,
    requestId: string,
    accept: boolean,
    deal?: { fare?: Partial<TripFareInput> | null; payModel?: BrokerPayModel | null },
  ): Promise<CargoRequest> {
    // the values are checked before anything changes
    const fare = accept && this.fares ? TripFareService.read(deal?.fare) : null;
    const request = await this.owned(requestId, (r) => r.companyUserId === companyUserId);
    if (request.status !== CargoRequestStatus.Pending) throw new ConflictException('notPending');

    if (accept && request.listing.status !== CargoListingStatus.Open) throw new ConflictException('taken');
    if (accept && (await this.requests.findActiveOffer(request.listingId))) throw new ConflictException('reserved');
    if (fare) await this.fares!.recordAgreed(request, fare, companyUserId);
    if (accept && request.forDriver) {
      const picked = deal?.payModel && Object.values(BrokerPayModel).includes(deal.payModel) ? deal.payModel : null;
      request.brokerPayModel = picked ?? (this.fares ? await this.fares.lastPayModel(companyUserId) : BrokerPayModel.Commission);
    }
    request.status = accept ? CargoRequestStatus.Accepted : CargoRequestStatus.Rejected;
    request.decidedAt = new Date();
    await this.requests.save(request);

    const company = await this.contact(companyUserId);
    const cargo = this.cargoTitle(request);
    // a broker has no trip of its own to follow: it brings the driver to the company
    const broker = accept && (await this.isBroker(request.driverUserId));
    const text = accept
      ? this.withFare(this.t(broker ? 'notify.acceptedBroker' : 'notify.accepted', { cargo, company: this.describe(company) }), fare)
      : this.t('notify.rejected', { cargo });
    if (broker) {
      // the broker answers for the load: it reports the delivery, the company confirms it
      await this.notify(request.driverUserId, text, [
        { id: `${TripAction.Deliver}${request.id}`, label: this.t('actions.delivered'), row: 0 },
        { id: `${TripAction.DriverRequests}1`, label: this.t('actions.myRequests'), row: 0 },
      ]);
      await this.completeAssignment(request);
    } else if (accept) {
      await this.notify(request.driverUserId, text, [
        { id: TripAction.ActiveTrip, label: this.t('actions.activeTrip'), row: 0 },
        { id: TripAction.ShareLocation, label: this.t('actions.shareLocation'), row: 0 },
      ]);
      await this.completeAssignment(request);
    } else {
      await this.notify(request.driverUserId, text);
    }
    // پنل‌های باز (درخواست‌های راننده، بارها و سفرهای شرکت) بی‌رفرش به‌روز شوند
    this.changed(request, undefined, text);
    return request;
  }

  /**
   * بار «برداشته شد» و بقیه‌ی درخواست‌های همین بار رد می‌شود؛ راننده‌هایشان فقط اگر صفحه‌شان در وب باز باشد (سوکت)
   * خبردار می‌شوند، نه در پیام‌رسان و نه با اعلان گوشی.
   */
  private async completeAssignment(request: CargoRequest): Promise<void> {
    await this.listings.setStatus(request.companyUserId, request.listingId, CargoListingStatus.Taken);
    for (const other of await this.requests.findOtherPending(request.listingId, request.id)) {
      other.status = CargoRequestStatus.Rejected;
      other.decidedAt = new Date();
      await this.requests.save(other);
      this.changed(other, undefined, this.t('notify.rejectedTaken', { cargo: this.cargoTitle(other) }));
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
  async offer(companyUserId: string, listingId: string, driverUserId: string, fareInput?: Partial<TripFareInput> | null): Promise<CargoRequest> {
    // the fare agreed with the driver (TripFare AGREED); the assistant hands loads without one, the company gives it at delivery
    const fare = fareInput && this.fares ? TripFareService.read(fareInput) : null;
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
    if (fare) await this.fares!.recordAgreed(full, fare, companyUserId);

    const company = await this.contact(companyUserId);
    const text = this.withFare(this.t('notify.offer', { company: this.describe(company), cargo: this.cargoTitle(full), minutes: OFFER_TTL_MINUTES }), fare);
    await this.notify(
      driverUserId,
      text,
      [
        { id: `${TripAction.OfferYes}${saved.id}`, label: this.t('actions.offerYes'), row: 0 },
        { id: `${TripAction.OfferNo}${saved.id}`, label: this.t('actions.offerNo'), row: 0 },
      ],
    );
    this.changed(full, undefined, text);
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
    const text = this.t('notify.offerExpiredDriver', { cargo });
    await this.notify(request.driverUserId, text);
    this.changed(request, undefined, text);
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
  private changed(
    request: CargoRequest,
    notice?: { type: 'newRequest' | 'requestCancelled' | 'deliveryReminder' | 'deliveryReported'; text: string },
    driverText?: string,
  ): void {
    const event = { requestId: request.id, listingId: request.listingId, status: request.status };
    this.gateway.sendToUser(request.companyUserId, CARGO_REQUEST_CHANGED_SOCKET_EVENT, { ...event, ...notice });
    // the driver's open panel shows the same news the messengers get
    this.gateway.sendToUser(request.driverUserId, CARGO_REQUEST_CHANGED_SOCKET_EVENT, driverText ? { ...event, type: 'driverNotice', text: driverText } : event);
  }

  //#endregion

  //#region ----------- Both: delivery ---------------------------------------

  /**
   * تحویل در دو قدم: راننده اعلامش می‌کند (سفر تا تأیید شرکت فعال می‌ماند و شرکت با دکمه‌ی تأیید خبردار
   * می‌شود)؛ شرکت با تأیید یا ثبت مستقیم، بار را «تحویل‌شده» می‌کند و راننده خبردار می‌شود.
   */
  async deliver(userId: string, requestId: string, fareInput?: Partial<TripFareInput> | null): Promise<CargoRequest> {
    const request = await this.owned(requestId, (r) => r.driverUserId === userId || r.companyUserId === userId);
    if (request.status !== CargoRequestStatus.Accepted) throw new ConflictException('notActive');
    const by = await this.contact(userId);
    const cargo = this.cargoTitle(request);

    if (userId === request.driverUserId) {
      // دوباره زدن: همان اعلام قبلی منتظر شرکت است
      if (request.deliveryReportedAt) return request;
      request.deliveryReportedAt = new Date();
      await this.requests.save(request);
      const text = this.t((await this.isBroker(userId)) ? 'notify.deliveryReportedBroker' : 'notify.deliveryReported', { cargo, by: this.describe(by) });
      // پنل وب باز شرکت: همان خبر به شکل اعلان
      this.changed(request, { type: 'deliveryReported', text });
      await this.notify(
        request.companyUserId,
        text,
        [
          { id: `${TripAction.Deliver}${request.id}`, label: this.t('actions.confirmDelivery'), row: 0 },
          { id: `${TripAction.RejectDelivery}${request.id}`, label: this.t('actions.rejectDelivery'), row: 0 },
          { id: `${TripAction.CompanyTrips}1`, label: this.t('actions.companyTrips'), row: 1 },
        ],
        { title: 'ترابوت · اعلام تحویل' },
      );
      return request;
    }

    // شرکت: تأیید اعلام راننده، یا ثبت مستقیم؛ با کرایه و وزن نهایی (TripFare DELIVERED)
    const fare = this.fares ? TripFareService.read(fareInput) : null;
    if (fare) await this.fares!.recordDelivered(request, fare, userId);
    const reported = !!request.deliveryReportedAt;
    request.status = CargoRequestStatus.Delivered;
    request.deliveredAt = new Date();
    // a broker's trip: what it gets is fixed now, at the admin's percent of today (a later change leaves it)
    if (request.forDriver && this.brokerAccess) await this.settleBroker(request, fare);
    await this.requests.save(request);
    const text = this.withFare(this.t(reported ? 'notify.deliveryConfirmed' : 'notify.deliveredByCompany', { cargo, by: this.describe(by) }), fare);
    // the finished trip is among «درخواست‌های من» (a broker's in its own panel)
    await this.notify(request.driverUserId, text, [], {
      title: reported ? 'ترابوت · تحویل تأیید شد' : 'ترابوت · تحویل ثبت شد',
      url: (await this.isBroker(request.driverUserId)) ? '/account/broker?tab=requests' : '/account/driver/requests',
    });
    // پنل‌های باز (سفرها، شمارنده‌ی سفرهای بی‌تحویل، خانه‌ی راننده) به‌روز شوند
    this.changed(request, undefined, text);
    return request;
  }

  /**
   * «تحویل نشده»: شرکت اعلام تحویل راننده را رد می‌کند؛ سفر فعال می‌ماند، راننده خبردار می‌شود و
   * می‌تواند بعداً دوباره اعلام کند.
   */
  async rejectDeliveryReport(companyUserId: string, requestId: string): Promise<CargoRequest> {
    const request = await this.owned(requestId, (r) => r.companyUserId === companyUserId);
    if (request.status !== CargoRequestStatus.Accepted) throw new ConflictException('notActive');
    if (!request.deliveryReportedAt) throw new ConflictException('notReported');
    request.deliveryReportedAt = null;
    await this.requests.save(request);
    const company = await this.contact(companyUserId);
    const text = this.t('notify.deliveryRejected', { cargo: this.cargoTitle(request), by: this.describe(company) });
    const broker = await this.isBroker(request.driverUserId);
    const back = broker
      ? { id: `${TripAction.DriverRequests}1`, label: this.t('actions.myRequests') }
      : { id: TripAction.ActiveTrip, label: this.t('actions.activeTrip') };
    // a driver to its active trip (from the button); a broker to its requests, in its own panel
    await this.notify(request.driverUserId, text, [back], { title: 'ترابوت · تحویل تأیید نشد', url: broker ? '/account/broker?tab=requests' : undefined });
    this.changed(request, undefined, text);
    return request;
  }

  //#endregion

  /**
   * A broker's share of a delivered trip (BrokerPayModel): COMMISSION, the admin's percent of the fare the company
   * confirmed; MARGIN, that fare less the one the broker gave the driver. Without a confirmed fare (no TripFareService)
   * the commission is on the broker's own fare, as before.
   */
  private async settleBroker(request: CargoRequest, fare: TripFareValues | null): Promise<void> {
    const { commissionPercent } = await this.brokerAccess!.getPolicy();
    const model = request.brokerPayModel ?? BrokerPayModel.Commission;
    request.brokerPayModel = model;
    request.brokerCommissionPercent = model === BrokerPayModel.Commission ? String(commissionPercent) : null;
    if (!fare) {
      const commission = model === BrokerPayModel.Commission ? brokerCommission(request.forDriver?.fare, commissionPercent) : null;
      request.brokerCommission = commission === null ? null : String(commission);
      request.brokerMargin = null;
      return;
    }
    const earning = brokerEarning(model, fare.total, fare.currency, fareAmount(request.forDriver?.fare), commissionPercent);
    request.brokerCommission = earning.commission === null ? null : String(earning.commission);
    request.brokerMargin = earning.margin === null ? null : String(earning.margin);
  }

  /** The company's form for a trip's fare at this stage (web dialog, bot form): its prefilled values (TripFareForm). */
  async fareForm(companyUserId: string, requestId: string, stage: TripFareStage): Promise<TripFareForm> {
    const request = await this.owned(requestId, (r) => r.companyUserId === companyUserId);
    if (!this.fares) throw new ConflictException('notActive');
    return this.fares.form(request, stage);
  }

  /** The form of a load handed to a driver (no request yet): from the load's own price and weight. */
  async offerFareForm(companyUserId: string, listingId: string): Promise<TripFareForm> {
    const listing = await this.ownOpenListing(companyUserId, listingId);
    return { stage: TripFareStage.Agreed, values: fareDefaultsFromListing(listing), agreed: null, broker: false, payModel: null };
  }

  /** A load's title as in the trip messages, for one of this company's open loads; null when it is not. */
  async listingTitle(listingId: string): Promise<string | null> {
    const listing = await this.listings.findById(listingId);
    return listing ? `${cargoLine(listing)}${listing.code ? ` · کد ${listing.code}` : ''}` : null;
  }

  /** A notice with the fare under it, so the other party sees what was recorded. */
  private withFare(text: string, fare: TripFareValues | null): string {
    return fare ? `${text}
💰 ${fareLine(fare)}` : text;
  }

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
    // a broker has no vehicle to locate
    if (await this.isBroker(request.driverUserId)) throw new ConflictException('broker');
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
    const trips = await this.activeTrips(driverUserId);
    // صفحه‌ی «سفرها»ی وب شرکت همان لحظه به‌روز شود، حتی برای به‌روزرسانی‌های بی‌صدای Live Location
    for (const trip of trips) {
      this.gateway.sendToUser(trip.companyUserId, TRIP_LOCATION_SOCKET_EVENT, {
        requestId: trip.id,
        location: { latitude: point.latitude, longitude: point.longitude, receivedAt, liveUntil },
      });
    }
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
    requests.push(...trips);

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

  /** A broker (واسط) asked for the load: it is the company's party for the trip, there is no driver to follow. */
  async isBroker(userId: string): Promise<boolean> {
    return !!(await this.profiles.cards([userId]))[0]?.broker;
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

  /**
   * از یک پیام‌رسان کاربر (MESSENGER_ORDER: اولین که وصل کرده و پیام را گرفت)، و اعلان گوشی. push: عنوان اعلان گوشی
   * (پیش‌فرض «ترابوت») و صفحه‌ای که باز می‌کند (پیش‌فرض از روی دکمه‌ها: pushUrl).
   */
  /** A notice through the user's one messenger (MESSENGER_ORDER) and the app's phone notification. */
  async notify(userId: string, text: string, actions: BotAction[] = [], push: { title?: string; url?: string } = {}): Promise<void> {
    const messenger = async () =>
      sendThroughOne(
        await this.botLinks.findAllByUserId(userId),
        (platform) => this.bots.hasPlatform(platform),
        { bot: (link) => this.bots.sendActionNotification(link.chatId, text, actions), whatsapp: () => this.whatsapp.notify(userId, text, actions) },
        (platform, error) => this.logger.warn(`Trip notification to ${userId} on ${platform} failed: ${error.message}`),
      );
    await Promise.all([
      messenger().catch((error: Error) => this.logger.warn(`Trip notification to ${userId} failed: ${error.message}`)),
      // the same news as a phone notification of the installed app, even while it is closed
      this.push
        ?.sendToUser(userId, { title: push.title ?? 'ترابوت', body: text, url: push.url ?? pushUrl(actions) })
        .catch((error: Error) => this.logger.warn(`Trip web push to ${userId} failed: ${error.message}`)),
    ]);
  }

  /** The text and the pin through the user's one messenger (MESSENGER_ORDER). */
  private async notifyLocation(userId: string, text: string, latitude: number, longitude: number): Promise<boolean> {
    const used = await sendThroughOne(
      await this.botLinks.findAllByUserId(userId),
      (platform) => this.bots.hasPlatform(platform),
      {
        bot: async (link) => {
          await this.bots.sendNotification(link.chatId, text);
          await this.bots.sendLocation(link.chatId, latitude, longitude);
        },
        whatsapp: () => this.whatsapp.sendLocation(userId, text, latitude, longitude),
      },
      (platform, error) => this.logger.warn(`Location to ${userId} on ${platform} failed: ${error.message}`),
    );
    return used !== null;
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`trip.${key}`, { lang: 'fa', args }) as string;
  }

  //#endregion
}
