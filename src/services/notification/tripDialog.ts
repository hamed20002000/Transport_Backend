import { ConflictException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { cargoLine, fa } from 'src/application/services/agent/tools/toolKit';
import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { CargoRequest } from 'src/domain/entities/notification/CargoRequest';
import { DriverLocation } from 'src/domain/entities/notification/DriverLocation';
import { CargoRequestStatus } from 'src/domain/enums/notification';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import {
  BotAction,
  BotContext,
  BotDialog,
  BotDialogRegistry,
  BotLocation,
  BotReply,
} from '../messengerBot/core/botDialog';
import { RedisService } from '../redis/redis.service';
import { CargoInsight, CargoInsightService, CargoRouteOption } from './cargoInsight.service';
import { CargoListingService } from './cargoListing.service';
import { persianDateTime } from 'src/domain/helper/persianDate';
import { CargoListingStatus } from 'src/domain/enums/notification';
import { GeoPoint, pointAtFraction } from '../routing/geo';
import { FuelStationService, RouteFuelStation } from '../routing/fuelStation.service';
import { MapMarker, MapMarkerKind, StaticMapService } from '../routing/staticMap.service';
import { CargoTripService } from './cargoTrip.service';
import { TripAction } from 'src/domain/constants/bot/TripAction';

const PREFIX = 'tr:';
const Action = {
  ...TripAction,
  Cancel: `${PREFIX}cx:`, // + requestId
  DriverRequests: `${PREFIX}dr:`, // + page
  Deliver: `${PREFIX}dv:`, // + requestId
  ReturnLoads: `${PREFIX}rt`,
  ReturnPage: `${PREFIX}rp:`, // + page
  ReturnCity: `${PREFIX}rc`,
  LocationRequest: `${PREFIX}lq:`, // + requestId
  RouteDetail: `${PREFIX}rd:`, // + listingId:index
  CargoReturns: `${PREFIX}rb:`, // + listingId:page
  NearStations: `${PREFIX}ns`,
  Close: `${PREFIX}close`,
} as const;

/** دکمه‌های بخش‌های دیگر (CargoDialog) */
const FIND_CARGO = 'cg:find:1';

const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];
const DRIVER_ROLES = ['DRIVER'];
const PAGE_SIZE = 5;
const RETURN_PAGE_SIZE = 6;
const SESSION_TTL_SECONDS = 30 * 60;
const MAX_CITY_LENGTH = 100;
const PER_ROW = 2;
const NEAR_RADIUS_KM = 30;
// آخرین زمان‌های دریافت موقعیت که برای شرکت نوشته می‌شود
const RECENT_LOCATIONS = 5;
const NEAR_LIMIT = 12;
// دکمه‌ی مسیریابی برای این تعداد از نزدیک‌ترین‌ها
const NEAR_NAVIGATE = 6;

const STATUS_ICON: Record<CargoRequestStatus, string> = {
  [CargoRequestStatus.Pending]: '⏳',
  [CargoRequestStatus.Accepted]: '🚚',
  [CargoRequestStatus.Rejected]: '❌',
  [CargoRequestStatus.Cancelled]: '⚪',
  [CargoRequestStatus.Delivered]: '✅',
};

interface TripSession {
  /** «بار برگشتی» منتظر نام شهر است. */
  waitingCity?: boolean;
  returnCity?: string;
}

/** ردیف‌بندی دکمه‌ها: هر add یک ردیف و grid چند ردیف دوتایی. */
class Rows {
  private row = 0;
  readonly actions: BotAction[] = [];

  add(...actions: BotAction[]): this {
    if (!actions.length) return this;
    this.actions.push(...actions.map((action) => ({ ...action, row: this.row })));
    this.row++;
    return this;
  }

  grid(actions: BotAction[], perRow = PER_ROW): this {
    for (let i = 0; i < actions.length; i += perRow) this.add(...actions.slice(i, i + perRow));
    return this;
  }
}

/**
 * بخش‌های راننده («درخواست‌های من»، «سفر فعال»، «بار برگشتی»، ارسال لوکیشن)
 * و شرکت («درخواست رانندگان»، «سفرهای فعال»، درخواست لوکیشن راننده).
 * منطق در CargoTripService است؛ اینجا فقط متن و دکمه.
 */
@Injectable()
export class TripDialog implements BotDialog, OnModuleInit {
  private readonly logger = new Logger(TripDialog.name);

  readonly entries: Record<string, string> = {
    [BotCallback.DriverLoadRequests]: `${Action.DriverRequests}1`,
    [BotCallback.DriverActiveTrip]: Action.ActiveTrip,
    [BotCallback.DriverReturnLoads]: Action.ReturnLoads,
    [BotCallback.DriverMyLocation]: Action.MyLocation,
    [BotCallback.DriverSendLocation]: Action.ShareLocation,
    [BotCallback.CompanyDriverRequests]: `${Action.CompanyRequests}1`,
    [BotCallback.CompanyActiveTrips]: `${Action.CompanyTrips}1`,
  };

  constructor(
    private readonly trips: CargoTripService,
    private readonly listings: CargoListingService,
    private readonly insights: CargoInsightService,
    private readonly maps: StaticMapService,
    private readonly fuelStations: FuelStationService,
    private readonly registry: BotDialogRegistry,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  isAction(id: string): boolean {
    return id.startsWith(PREFIX);
  }

  async hasSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<boolean> {
    return !!(await this.getSession(ctx))?.waitingCity;
  }

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.isAction(id)) return null;
    try {
      return await this.route(ctx, id);
    } catch (error) {
      this.logger.error(`Trip action ${id} failed for ${ctx.userId}: ${(error as Error).message}`);
      return { text: this.t('failed'), actions: [this.back()] };
    }
  }

  async handleText(ctx: BotContext, text: string): Promise<BotReply | null> {
    const session = await this.getSession(ctx);
    if (!session?.waitingCity) return null;
    const city = text.trim();
    if (!city || city.length > MAX_CITY_LENGTH) return this.askCity(this.t('return.badCity'));
    await this.saveSession(ctx, { returnCity: city });
    return this.returnView(ctx, city, 1);
  }

  /** لوکیشن راننده؛ برای بقیه‌ی نقش‌ها null تا پیام «پشتیبانی نمی‌شود» برود. */
  async handleLocation(ctx: BotContext, location: BotLocation): Promise<BotReply | null> {
    if (!(await this.hasRole(ctx, DRIVER_ROLES))) return null;
    const { sent, receivedAt } = await this.trips.saveLocation(ctx.userId, location);
    const lines = [
      this.t(location.livePeriod ? 'location.savedLive' : 'location.saved', { time: persianDateTime(receivedAt) }),
      sent ? this.t('location.sentTo', { count: fa(sent) }) : '',
      location.livePeriod ? '' : this.t('location.liveTip'),
    ];
    return {
      text: lines.filter(Boolean).join('\n\n'),
      actions: new Rows()
        .add({ id: Action.MyLocation, label: this.t('actions.myLocation') }, { id: Action.ActiveTrip, label: this.t('actions.activeTrip') })
        .add(this.back()).actions,
    };
  }

  //#region ----------- Routing -------------------------------------------------

  private async route(ctx: BotContext, id: string): Promise<BotReply> {
    if (id === Action.Close) {
      await this.clearSession(ctx);
      return { text: '', actions: [], closed: 'exit' };
    }

    const isCompanyAction = [Action.CompanyRequests, Action.CompanyTrips, Action.Accept, Action.Reject, Action.Location, Action.LocationRequest]
      .some((prefix) => id.startsWith(prefix));
    // تحویل را هر دو طرف ثبت می‌کنند
    const roles = id.startsWith(Action.Deliver) ? [...DRIVER_ROLES, ...COMPANY_ROLES] : isCompanyAction ? COMPANY_ROLES : DRIVER_ROLES;
    if (!(await this.hasRole(ctx, roles))) {
      await this.clearSession(ctx);
      return { text: this.t(isCompanyAction ? 'onlyCompany' : 'onlyDriver'), actions: [], closed: 'denied' };
    }

    const arg = (prefix: string) => id.slice(prefix.length);

    // راننده
    if (id.startsWith(Action.Request)) return this.request(ctx, arg(Action.Request));
    if (id.startsWith(Action.Cancel)) return this.cancel(ctx, arg(Action.Cancel));
    if (id.startsWith(Action.DriverRequests)) return this.driverRequestsView(ctx, this.page(arg(Action.DriverRequests)));
    if (id === Action.ActiveTrip) return this.activeTripView(ctx);
    if (id === Action.ShareLocation) return this.shareLocation();
    if (id === Action.MyLocation) return this.myLocation(ctx);
    if (id === Action.NearStations) return this.nearStations(ctx);
    if (id.startsWith(Action.Detail)) return this.cargoDetail(ctx, arg(Action.Detail));
    if (id.startsWith(Action.RouteDetail)) {
      const [listingId, index] = arg(Action.RouteDetail).split(':');
      return this.routeDetail(ctx, listingId, this.page(index));
    }
    if (id.startsWith(Action.CargoReturns)) {
      const [listingId, page] = arg(Action.CargoReturns).split(':');
      return this.cargoReturns(ctx, listingId, this.page(page));
    }
    if (id === Action.ReturnLoads) return this.startReturn(ctx);
    if (id === Action.ReturnCity) return this.startCityInput(ctx);
    if (id.startsWith(Action.ReturnPage)) {
      const city = (await this.getSession(ctx))?.returnCity ?? (await this.trips.lastDestination(ctx.userId));
      return city ? this.returnView(ctx, city, this.page(arg(Action.ReturnPage))) : this.startCityInput(ctx);
    }

    // شرکت
    if (id.startsWith(Action.CompanyRequests)) return this.companyRequestsView(ctx, this.page(arg(Action.CompanyRequests)));
    if (id.startsWith(Action.CompanyTrips)) return this.companyTripsView(ctx, this.page(arg(Action.CompanyTrips)));
    if (id.startsWith(Action.Accept)) return this.decide(ctx, arg(Action.Accept), true);
    if (id.startsWith(Action.Reject)) return this.decide(ctx, arg(Action.Reject), false);
    if (id.startsWith(Action.Location)) return this.showLocation(ctx, arg(Action.Location));
    if (id.startsWith(Action.LocationRequest)) return this.requestLocation(ctx, arg(Action.LocationRequest));

    if (id.startsWith(Action.Deliver)) return this.deliver(ctx, arg(Action.Deliver));
    return { text: this.t('failed'), actions: [this.back()] };
  }

  //#endregion

  //#region ----------- Driver: request / my requests ---------------------------

  private async request(ctx: BotContext, listingId: string): Promise<BotReply> {
    let notice: string;
    try {
      const request = await this.trips.request(ctx.userId, listingId);
      notice = this.t('request.sent', { cargo: this.trips.cargoTitle(request) });
    } catch (error) {
      notice = this.conflictText(error, 'request');
    }
    return {
      text: notice,
      actions: new Rows()
        .add(
          { id: `${Action.DriverRequests}1`, label: this.t('actions.myRequests') },
          { id: FIND_CARGO, label: this.t('actions.findCargo') },
        )
        .add(this.back()).actions,
    };
  }

  private async cancel(ctx: BotContext, requestId: string): Promise<BotReply> {
    let notice: string;
    try {
      await this.trips.cancel(ctx.userId, requestId);
      notice = this.t('request.cancelled');
    } catch (error) {
      notice = this.conflictText(error, 'request');
    }
    return this.driverRequestsView(ctx, 1, notice);
  }

  private async driverRequestsView(ctx: BotContext, page: number, notice?: string): Promise<BotReply> {
    const [items, total] = await this.trips.driverRequests(ctx.userId, page, PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages && total > 0) return this.driverRequestsView(ctx, pages, notice);

    let body = this.t('myRequests.empty');
    const cancels: BotAction[] = [];
    if (items.length) {
      body = items
        .map((request, i) => {
          const index = fa((page - 1) * PAGE_SIZE + i + 1);
          if (request.status === CargoRequestStatus.Pending) {
            cancels.push({ id: `${Action.Cancel}${request.id}`, label: this.t('actions.cancelRequest', { index }) });
          }
          return [
            `${index}. ${this.trips.cargoTitle(request)}`,
            request.listing?.companyName ? this.t('myRequests.company', { company: request.listing.companyName }) : '',
            `${STATUS_ICON[request.status]} ${this.t(`status.${request.status}`)} · ${this.ago(request.updatedAt)}`,
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n');
      if (pages > 1) body += `\n\n${this.t('page', { page: fa(page), pages: fa(pages) })}`;
    }

    const rows = new Rows()
      .grid(cancels)
      .add(...this.pager(Action.DriverRequests, page, pages))
      .add({ id: Action.ActiveTrip, label: this.t('actions.activeTrip') }, { id: FIND_CARGO, label: this.t('actions.findCargo') })
      .add(this.back());
    return { text: [notice, this.t('myRequests.title'), body].filter(Boolean).join('\n\n'), actions: rows.actions };
  }

  //#endregion

  //#region ----------- Driver: active trip / location -------------------------

  private async activeTripView(ctx: BotContext, notice?: string): Promise<BotReply> {
    const trips = await this.trips.activeTrips(ctx.userId);
    if (!trips.length) {
      return {
        text: [notice, this.t('activeTrip.title'), this.t('activeTrip.empty')].filter(Boolean).join('\n\n'),
        actions: new Rows()
          .add({ id: FIND_CARGO, label: this.t('actions.findCargo') }, { id: `${Action.DriverRequests}1`, label: this.t('actions.myRequests') })
          .add({ id: Action.ReturnLoads, label: this.t('actions.returnLoads') }, this.back()).actions,
      };
    }

    const location = await this.trips.lastLocation(ctx.userId);
    const body = trips
      .map((trip, i) => {
        const listing = trip.listing;
        return [
          trips.length > 1 ? `${fa(i + 1)})` : '',
          listing.text,
          this.t('activeTrip.since', { ago: this.ago(trip.decidedAt ?? trip.updatedAt) }),
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n➖➖➖\n\n');

    const delivers = trips.map((trip, i) => ({
      id: `${Action.Deliver}${trip.id}`,
      label: this.t(trips.length > 1 ? 'actions.deliveredN' : 'actions.delivered', { index: fa(i + 1) }),
    }));
    const routes = trips.map((trip, i) => ({
      id: `${Action.Detail}${trip.listingId}`,
      label: this.t(trips.length > 1 ? 'actions.tripRouteN' : 'actions.tripRoute', { index: fa(i + 1) }),
    }));
    const rows = new Rows()
      .grid(delivers)
      .grid(routes)
      .add({ id: Action.ShareLocation, label: this.t('actions.shareLocation') }, { id: Action.ReturnLoads, label: this.t('actions.returnLoads') })
      .add(this.back());
    return {
      text: [notice, this.t('activeTrip.title'), body, this.locationLine(location)].filter(Boolean).join('\n\n'),
      actions: rows.actions,
    };
  }

  /** دکمه‌ی کیبورد پایین با request_location؛ Live Location فقط از منوی پیوست تلگرام. */
  private shareLocation(): BotReply {
    return { text: this.t('location.ask'), actions: [], locationButton: this.t('actions.sendLocationNow') };
  }

  private async deliver(ctx: BotContext, requestId: string): Promise<BotReply> {
    let request: CargoRequest | null = null;
    let notice: string;
    try {
      request = await this.trips.deliver(ctx.userId, requestId);
      notice = this.t('delivered.done', { cargo: this.trips.cargoTitle(request) });
    } catch (error) {
      notice = this.conflictText(error, 'trip');
    }
    const byCompany = request ? request.companyUserId === ctx.userId : await this.hasRole(ctx, COMPANY_ROLES);
    return byCompany ? this.companyTripsView(ctx, 1, notice) : this.activeTripView(ctx, notice);
  }

  //#endregion

  //#region ----------- Driver: return loads -----------------------------------

  private async startReturn(ctx: BotContext): Promise<BotReply> {
    const city = (await this.getSession(ctx))?.returnCity ?? (await this.trips.lastDestination(ctx.userId));
    return city ? this.returnView(ctx, city, 1) : this.startCityInput(ctx);
  }

  private async startCityInput(ctx: BotContext): Promise<BotReply> {
    await this.saveSession(ctx, { ...(await this.getSession(ctx)), waitingCity: true });
    return this.askCity();
  }

  private askCity(problem?: string): BotReply {
    return {
      text: [problem, this.t('return.askCity')].filter(Boolean).join('\n\n'),
      actions: [this.back()],
    };
  }

  private async returnView(ctx: BotContext, city: string, page: number): Promise<BotReply> {
    const result = await this.listings.listOpen({ page, pageSize: RETURN_PAGE_SIZE, origin: city });
    const pages = Math.max(1, Math.ceil(result.total / RETURN_PAGE_SIZE));
    if (page > pages && result.total > 0) return this.returnView(ctx, city, pages);

    let body = this.t('return.empty', { city });
    const requests: BotAction[] = [];
    if (result.items.length) {
      body = result.items
        .map((item, i) => {
          const index = fa((page - 1) * RETURN_PAGE_SIZE + i + 1);
          requests.push({ id: `${Action.Detail}${item.id}`, label: this.t('actions.detailN', { index }) });
          return [
            `${index}. ${cargoLine(item)}${item.code ? ` · کد ${item.code}` : ''}`,
            item.companyName ? `🏢 ${item.companyName}${item.contactPhones?.length ? ` · 📞 ${item.contactPhones.join('، ')}` : ''}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n');
      if (pages > 1) body += `\n\n${this.t('page', { page: fa(page), pages: fa(pages) })}`;
    }

    const rows = new Rows()
      .grid(requests)
      .add(...this.pager(Action.ReturnPage, page, pages))
      .add({ id: Action.ReturnCity, label: this.t('actions.otherCity') }, this.back());
    return { text: [this.t('return.title', { city }), body].join('\n\n'), actions: rows.actions };
  }

  //#endregion

  //#region ----------- Driver: cargo detail / routes / fuel ------------------

  /**
   * جزئیات یک بار برای تصمیم راننده: متن بار، مسافت و زمان و سوخت سریع‌ترین
   * مسیر، فاصله‌ی خودش تا مبدأ، بار برگشتی از مقصد و مسیرهای جایگزین.
   */
  private async cargoDetail(ctx: BotContext, listingId: string): Promise<BotReply> {
    await ctx.progress?.(this.t('detail.computing'));
    const insight = await this.insights.build(listingId, ctx.userId);
    if (!insight) return { text: this.t('notFound'), actions: [{ id: FIND_CARGO, label: this.t('actions.findCargo') }, this.back()] };

    const { listing, routes, profile } = insight;
    const lines: string[] = [this.t('detail.title'), listing.text, '➖➖➖', this.t('detail.routeTitle', { origin: listing.origin, destination: listing.destination })];

    const missing = !insight.originPoint ? listing.origin : !insight.destinationPoint ? listing.destination : null;
    if (missing) lines.push(this.t('detail.noGeo', { place: missing }));
    else if (!routes.length) lines.push(this.t('detail.noRoute'));
    else {
      const best = routes[0];
      lines.push(
        this.t('detail.distance', { km: this.km(best.distanceKm), time: this.duration(best.truckMinutes), vehicle: profile.label }),
        this.trafficLine(best),
        this.t('detail.fuel', {
          liters: this.number(best.fuelLiters),
          fuel: this.t(`fuel.${profile.fuel}`),
          rate: this.number(profile.litersPer100Km),
        }),
      );
    }
    lines.push(this.driverLine(insight));
    lines.push(this.returnLine(insight));

    if (routes.length) {
      const fastest = routes[0];
      lines.push(
        [
          this.t('detail.routesTitle', { count: fa(routes.length) }),
          ...routes.map((route, i) =>
            this.t('detail.routeItem', {
              index: fa(i + 1),
              name: this.routeName(route),
              km: this.km(route.distanceKm),
              time: this.duration(route.truckMinutes),
              liters: this.number(route.fuelLiters),
              extra: i > 0 ? this.t('detail.longer', { km: this.km(route.distanceKm - fastest.distanceKm) }) : '',
              traffic: route.traffic ? ` · 🚦 ${this.t(`traffic.${route.traffic.level}`)}` : '',
            }),
          ),
          this.fasterNow(routes),
          routes.length === 1 ? this.t('detail.singleRoute') : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    const rows = new Rows().add(
      ...routes.map((_, i) => ({ id: `${Action.RouteDetail}${listing.id}:${i + 1}`, label: this.t('actions.routeN', { index: fa(i + 1) }) })),
    );
    const secondRow: BotAction[] = [];
    if (insight.returnLoads.fromDestination) {
      secondRow.push({
        id: `${Action.CargoReturns}${listing.id}:1`,
        label: this.t('actions.cargoReturns', { count: fa(insight.returnLoads.fromDestination) }),
      });
    }
    if (listing.status === CargoListingStatus.Open) secondRow.push({ id: `${Action.Request}${listing.id}`, label: this.t('actions.requestThis') });
    rows.add(...secondRow);
    if (insight.originPoint && insight.destinationPoint) {
      rows.add({ id: 'map', label: this.t('actions.openMap'), url: this.mapsUrl(insight.originPoint, insight.destinationPoint) });
    }
    if (!insight.driver) rows.add({ id: Action.ShareLocation, label: this.t('actions.sendMyLocation') });
    rows.add({ id: FIND_CARGO, label: this.t('actions.findCargo') }, this.back());
    const photo = await this.routesMap(insight);
    return { text: lines.filter(Boolean).join('\n\n'), actions: rows.actions, ...(photo ? { photo } : {}) };
  }

  /** یک مسیر: مسافت، زمان، سوخت و جایگاه‌های سوخت سر راه با کیلومترشان. */
  private async routeDetail(ctx: BotContext, listingId: string, index: number): Promise<BotReply> {
    const insight = await this.insights.build(listingId);
    const route = insight?.routes[index - 1];
    if (!insight || !route) return this.cargoDetail(ctx, listingId);

    const { listing, profile, routes } = insight;
    const fuel = await this.insights.fuelAlong(route);
    let shown: RouteFuelStation[] = [];
    const lines = [
      this.t('route.title', { index: fa(index), count: fa(routes.length), origin: listing.origin, destination: listing.destination }),
      this.routeName(route),
      this.t('detail.distance', { km: this.km(route.distanceKm), time: this.duration(route.truckMinutes), vehicle: profile.label }),
      this.trafficLine(route),
      this.t('detail.fuel', { liters: this.number(route.fuelLiters), fuel: this.t(`fuel.${profile.fuel}`), rate: this.number(profile.litersPer100Km) }),
    ];

    if (fuel.coverage === 'none') lines.push(this.t('route.stationsLoading'));
    else {
      lines.push(this.t('route.stationsCount', { count: fa(fuel.stations.length) }));
      if (fuel.coverage === 'partial') lines.push(this.t('route.stationsPartial'));
      if (fuel.longestGap) {
        const gap = fuel.longestGap.toKm - fuel.longestGap.fromKm;
        lines.push(
          this.t(gap >= 150 ? 'route.gapWarning' : 'route.gap', {
            km: this.km(gap),
            from: this.km(fuel.longestGap.fromKm),
            to: this.km(fuel.longestGap.toKm),
          }),
        );
      }
      if (fuel.stations.length) {
        shown = this.spread(fuel.stations, 20);
        lines.push(
          [
            shown.length < fuel.stations.length ? this.t('route.stationsSome', { shown: fa(shown.length) }) : this.t('route.stationsAll'),
            ...shown.map((station, i) =>
              this.t('route.station', {
                index: fa(i + 1),
                km: this.km(station.atKm),
                name: station.name || this.t('route.unnamed'),
                kinds: this.kinds(station),
              }),
            ),
          ].join('\n'),
          this.t('route.legend'),
        );
      }
    }

    // نقشه: همین مسیر، جایگاه‌های فهرست با همان شماره و بقیه‌ی جایگاه‌ها نقطه‌ی کوچک
    await ctx.progress?.(this.t('map.drawing'));
    const numbered = new Map(shown.map((station, i) => [station.id, String(i + 1)]));
    const photo = await this.mapPhoto(
      [{ points: route.points, primary: true }],
      [
        ...fuel.stations.map((station) => this.stationMarker(station, numbered.get(station.id))),
        ...this.endpoints(insight),
      ],
      this.t('map.routeCaption', { index: fa(index) }),
    );

    const nav: BotAction[] = [];
    if (index > 1) nav.push({ id: `${Action.RouteDetail}${listing.id}:${index - 1}`, label: this.t('actions.previousRoute') });
    if (index < routes.length) nav.push({ id: `${Action.RouteDetail}${listing.id}:${index + 1}`, label: this.t('actions.nextRoute') });
    const rows = new Rows();
    if (insight.originPoint && insight.destinationPoint) {
      rows.add({
        id: 'map',
        label: this.t('actions.openRouteMap'),
        url: this.mapsUrl(insight.originPoint, insight.destinationPoint, [pointAtFraction(route.points, 1 / 3), pointAtFraction(route.points, 2 / 3)]),
      });
    }
    rows.add(...nav).add({ id: `${Action.Detail}${listing.id}`, label: this.t('actions.backToCargo') }, this.back());
    return { text: lines.filter(Boolean).join('\n\n'), actions: rows.actions, ...(photo ? { photo } : {}) };
  }

  /** بارهای باز از مقصد این بار؛ آن‌هایی که به مبدأش برمی‌گردند اول. */
  private async cargoReturns(ctx: BotContext, listingId: string, page: number): Promise<BotReply> {
    const listing = await this.listings.findById(listingId);
    if (!listing) return { text: this.t('notFound'), actions: [this.back()] };
    const result = await this.insights.returnLoadList(listing, page, RETURN_PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(result.total / RETURN_PAGE_SIZE));

    const details: BotAction[] = [];
    const body = result.items.length
      ? result.items
          .map((item, i) => {
            const index = fa((page - 1) * RETURN_PAGE_SIZE + i + 1);
            details.push({ id: `${Action.Detail}${item.id}`, label: this.t('actions.detailN', { index }) });
            return [
              `${index}. ${cargoLine(item)}${item.code ? ` · کد ${item.code}` : ''}${item.toOrigin ? ` ${this.t('returns.toOrigin')}` : ''}`,
              item.companyName ? `🏢 ${item.companyName}` : '',
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n')
      : this.t('return.empty', { city: listing.destination });

    const rows = new Rows()
      .grid(details)
      .add(...this.pager(`${Action.CargoReturns}${listing.id}:`, page, pages))
      .add({ id: `${Action.Detail}${listing.id}`, label: this.t('actions.backToCargo') }, this.back());
    return {
      text: [this.t('returns.title', { destination: listing.destination, origin: listing.origin }), body].join('\n\n'),
      actions: rows.actions,
    };
  }

  /** «موقعیت من»: آخرین موقعیت ثبت‌شده روی نقشه، یا درخواست ارسال اگر نیست. */
  private async myLocation(ctx: BotContext): Promise<BotReply> {
    const location = await this.trips.lastLocation(ctx.userId);
    if (!location) {
      const ask = this.shareLocation();
      return { ...ask, text: `${this.t('myLocation.none')}\n\n${ask.text}` };
    }
    await this.trips.sendPin(ctx, location.latitude, location.longitude).catch((error: Error) =>
      this.logger.warn(`Could not send own location to ${ctx.userId}: ${error.message}`),
    );
    return {
      text: [this.t('myLocation.title'), this.locationLine(location)].join('\n\n'),
      actions: new Rows()
        .add({ id: 'map', label: this.t('actions.openMyMap'), url: `https://maps.google.com/?q=${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}` })
        .add({ id: Action.NearStations, label: this.t('actions.nearStations') })
        .add({ id: Action.ShareLocation, label: this.t('actions.updateLocation') }, { id: FIND_CARGO, label: this.t('actions.findCargo') })
        .add(this.back()).actions,
    };
  }

  /** نزدیک‌ترین جایگاه‌های سوخت به آخرین موقعیت راننده، روی نقشه با شماره و دکمه‌ی مسیریابی. */
  private async nearStations(ctx: BotContext): Promise<BotReply> {
    const location = await this.trips.lastLocation(ctx.userId);
    if (!location) {
      const ask = this.shareLocation();
      return { ...ask, text: `${this.t('near.needLocation')}\n\n${ask.text}` };
    }
    const me = { lat: location.latitude, lng: location.longitude };
    const stations = await this.fuelStations.near(me, NEAR_RADIUS_KM, NEAR_LIMIT);
    const back = new Rows().add({ id: Action.MyLocation, label: this.t('actions.myLocation') }, this.back());
    if (!stations.length) {
      return { text: [this.t('near.title'), this.t('near.none', { km: fa(NEAR_RADIUS_KM) })].join('\n\n'), actions: back.actions };
    }

    await ctx.progress?.(this.t('map.drawing'));
    const photo = await this.mapPhoto(
      [],
      [{ point: me, kind: 'driver' }, ...stations.map((station, i) => this.stationMarker(station, String(i + 1)))],
      this.t('map.nearCaption'),
    );
    const list = stations.map((station, i) =>
      this.t('near.item', {
        index: fa(i + 1),
        name: station.name || this.t('route.unnamed'),
        km: this.km(station.distanceKm),
        kinds: this.kinds(station),
      }),
    );
    const rows = new Rows().grid(
      stations.slice(0, NEAR_NAVIGATE).map((station, i) => ({
        id: `nav${i}`,
        label: this.t('actions.navigateN', { index: fa(i + 1) }),
        url: this.mapsUrl(me, { lat: station.lat, lng: station.lng }),
      })),
      3,
    );
    rows.add(...back.actions);
    return {
      text: [this.t('near.title'), this.locationLine(location), list.join('\n'), this.t('route.legend')].join('\n\n'),
      actions: rows.actions,
      ...(photo ? { photo } : {}),
    };
  }

  /** نقشه‌ی همه‌ی مسیرهای جایگزین با شماره‌ی هر مسیر. */
  private async routesMap(insight: CargoInsight): Promise<BotReply['photo'] | null> {
    if (!insight.routes.length) return null;
    return this.mapPhoto(
      insight.routes.map((route, i) => ({ points: route.points, primary: i === 0, label: String(i + 1) })),
      this.endpoints(insight),
      this.t('map.routesCaption', { count: fa(insight.routes.length) }),
    );
  }

  /** ساخت نقشه نباید جلوی جواب را بگیرد: اگر نشد، فقط متن می‌رود. */
  private async mapPhoto(
    lines: { points: GeoPoint[]; primary?: boolean; label?: string; color?: string }[],
    markers: MapMarker[],
    caption: string,
  ): Promise<BotReply['photo'] | null> {
    try {
      return { image: await this.maps.render({ lines, markers }), caption };
    } catch (error) {
      this.logger.warn(`Map render failed: ${(error as Error).message}`);
      return null;
    }
  }

  private endpoints(insight: CargoInsight): MapMarker[] {
    const markers: MapMarker[] = [];
    if (insight.originPoint) markers.push({ point: insight.originPoint, kind: 'origin' });
    if (insight.destinationPoint) markers.push({ point: insight.destinationPoint, kind: 'destination' });
    return markers;
  }

  /** گازوئیل مهم‌تر از CNG برای کامیون؛ نوع نامعلوم = بنزین (تقریباً همه‌ی جایگاه‌ها). */
  private stationMarker(station: RouteFuelStation, label?: string): MapMarker {
    const kind: MapMarkerKind = station.diesel ? 'diesel' : station.cng ? 'cng' : 'gasoline';
    return { point: { lat: station.lat, lng: station.lng }, kind, ...(label ? { label } : {}) };
  }

  private kinds(station: { diesel: boolean | null; cng: boolean | null }): string {
    return [station.diesel ? ' 🛢' : '', station.cng ? ' 💨' : ''].join('');
  }

  /** «🚦 ترافیک همین الان: 🟡 نیمه‌سنگین (۲۵ دقیقه تأخیر)» */
  private trafficLine(route: CargoRouteOption): string {
    if (!route.traffic) return '';
    return this.t('detail.traffic', {
      level: this.t(`traffic.${route.traffic.level}`),
      delay: route.traffic.delayMin >= 1 ? this.t('traffic.delay', { time: this.duration(route.traffic.delayMin) }) : '',
    });
  }

  /** وقتی ترافیک ترتیب را عوض کرده: مسیری که الان زودتر می‌رسد. */
  private fasterNow(routes: CargoRouteOption[]): string {
    if (!routes[0]?.traffic) return '';
    const best = routes.reduce((winner, route, i) => (route.truckMinutes < routes[winner].truckMinutes ? i : winner), 0);
    if (best === 0 || routes[0].truckMinutes - routes[best].truckMinutes < 10) return '';
    return this.t('detail.fasterNow', { index: fa(best + 1), time: this.duration(routes[0].truckMinutes - routes[best].truckMinutes) });
  }

  private driverLine(insight: CargoInsight): string {
    if (!insight.driver) return this.t('detail.noDriverLocation');
    return this.t('detail.driverDistance', {
      km: this.km(insight.driver.distanceKm),
      time: this.duration(insight.driver.durationMin * insight.profile.durationFactor),
      ago: this.ago(insight.driver.locatedAt),
    });
  }

  private returnLine(insight: CargoInsight): string {
    const { fromDestination, toOrigin } = insight.returnLoads;
    if (!fromDestination) return this.t('detail.noReturn', { destination: insight.listing.destination });
    return this.t('detail.returns', {
      destination: insight.listing.destination,
      count: fa(fromDestination),
      back: toOrigin ? this.t('detail.returnsBack', { count: fa(toOrigin), origin: insight.listing.origin }) : '',
    });
  }

  /** «از طریق سمنان · جاده ۴۴» */
  private routeName(route: CargoRouteOption): string {
    const parts = [
      route.via ? this.t('route.via', { place: route.via }) : '',
      route.roads.length ? this.t('route.roads', { roads: route.roads.map((road) => (/^\d+$/.test(road) ? `جاده ${fa(road)}` : road)).join('، ') }) : '',
    ].filter(Boolean);
    return parts.join(' · ') || this.t('route.unnamedRoute');
  }

  /** حداکثر n جایگاه با فاصله‌ی تقریباً یکسان روی مسیر (اول و آخر همیشه). */
  private spread<T extends { atKm: number }>(items: T[], n: number): T[] {
    if (items.length <= n) return items;
    const step = (items[items.length - 1].atKm - items[0].atKm) / (n - 1);
    const picked = new Set<T>();
    for (let i = 0; i < n; i++) {
      const target = items[0].atKm + step * i;
      picked.add(items.reduce((best, item) => (Math.abs(item.atKm - target) < Math.abs(best.atKm - target) ? item : best)));
    }
    return items.filter((item) => picked.has(item));
  }

  private mapsUrl(origin: GeoPoint, destination: GeoPoint, waypoints: GeoPoint[] = []): string {
    const point = (p: GeoPoint) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    const params = new URLSearchParams({ api: '1', origin: point(origin), destination: point(destination), travelmode: 'driving' });
    if (waypoints.length) params.set('waypoints', waypoints.map(point).join('|'));
    return `https://www.google.com/maps/dir/?${params}`;
  }

  private km(value: number): string {
    return this.number(value < 10 ? Math.round(value * 10) / 10 : Math.round(value));
  }

  private number(value: number): string {
    return value.toLocaleString('fa-IR');
  }

  /** «۱۵ ساعت و ۲۰ دقیقه» */
  private duration(minutes: number): string {
    const total = Math.max(1, Math.round(minutes));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (!hours) return this.t('time.minutes', { m: fa(rest) });
    return rest ? this.t('time.hoursMinutes', { h: fa(hours), m: fa(rest) }) : this.t('time.hours', { h: fa(hours) });
  }

  //#endregion

  //#region ----------- Company: requests / trips ------------------------------

  private async companyRequestsView(ctx: BotContext, page: number, notice?: string): Promise<BotReply> {
    const [items, total] = await this.trips.companyRequests(ctx.userId, page, PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages && total > 0) return this.companyRequestsView(ctx, pages, notice);

    const rows = new Rows();
    let body = this.t('companyRequests.empty');
    if (items.length) {
      const blocks: string[] = [];
      for (const [i, request] of items.entries()) {
        const index = fa((page - 1) * PAGE_SIZE + i + 1);
        const driver = await this.trips.contact(request.driverUserId);
        blocks.push(
          this.t('companyRequests.item', {
            index,
            driver: this.trips.describe(driver),
            cargo: this.trips.cargoTitle(request),
            ago: this.ago(request.createdAt),
          }),
        );
        rows.add(
          { id: `${Action.Accept}${request.id}`, label: this.t('actions.acceptN', { index }) },
          { id: `${Action.Reject}${request.id}`, label: this.t('actions.rejectN', { index }) },
          { id: `${Action.Location}${request.id}`, label: this.t('actions.locationN', { index }) },
        );
      }
      body = blocks.join('\n\n');
      if (pages > 1) body += `\n\n${this.t('page', { page: fa(page), pages: fa(pages) })}`;
    }

    rows
      .add(...this.pager(Action.CompanyRequests, page, pages))
      .add({ id: `${Action.CompanyTrips}1`, label: this.t('actions.companyTrips') }, this.back());
    return {
      text: [notice, this.t('companyRequests.title'), this.t('companyRequests.hint'), body].filter(Boolean).join('\n\n'),
      actions: rows.actions,
    };
  }

  private async companyTripsView(ctx: BotContext, page: number, notice?: string): Promise<BotReply> {
    const [items, total] = await this.trips.companyTrips(ctx.userId, page, PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages && total > 0) return this.companyTripsView(ctx, pages, notice);

    let body = this.t('companyTrips.empty');
    const buttons: BotAction[] = [];
    if (items.length) {
      const blocks: string[] = [];
      for (const [i, trip] of items.entries()) {
        const index = fa((page - 1) * PAGE_SIZE + i + 1);
        const [driver, location] = await Promise.all([
          this.trips.contact(trip.driverUserId),
          this.trips.lastLocation(trip.driverUserId),
        ]);
        blocks.push(
          [
            this.t('companyTrips.item', {
              index,
              driver: this.trips.describe(driver),
              cargo: this.trips.cargoTitle(trip),
              ago: this.ago(trip.decidedAt ?? trip.updatedAt),
            }),
            this.locationLine(location),
          ].join('\n'),
        );
        buttons.push(
          { id: `${Action.Location}${trip.id}`, label: this.t('actions.locationN', { index }) },
          { id: `${Action.Deliver}${trip.id}`, label: this.t('actions.deliveredN', { index }) },
        );
      }
      body = blocks.join('\n\n');
      if (pages > 1) body += `\n\n${this.t('page', { page: fa(page), pages: fa(pages) })}`;
    }

    const rows = new Rows()
      .grid(buttons)
      .add(...this.pager(Action.CompanyTrips, page, pages))
      .add({ id: `${Action.CompanyRequests}1`, label: this.t('actions.allRequests') }, this.back());
    return { text: [notice, this.t('companyTrips.title'), body].filter(Boolean).join('\n\n'), actions: rows.actions };
  }

  private async decide(ctx: BotContext, requestId: string, accept: boolean): Promise<BotReply> {
    let notice: string;
    try {
      const request = await this.trips.decide(ctx.userId, requestId, accept);
      notice = this.t(accept ? 'decision.accepted' : 'decision.rejected', { cargo: this.trips.cargoTitle(request) });
    } catch (error) {
      notice = this.conflictText(error, 'decision');
    }
    return this.companyRequestsView(ctx, 1, notice);
  }

  /** آخرین موقعیت (پین روی نقشه) و دکمه‌ی درخواست موقعیت تازه؛ اگر نبود، همان موقع درخواست می‌شود. */
  private async showLocation(ctx: BotContext, requestId: string): Promise<BotReply> {
    const request = await this.trips.forCompany(ctx.userId, requestId);
    if (!request) return this.companyTripsView(ctx, 1, this.t('notFound'));
    const location = await this.trips.lastLocation(request.driverUserId);
    if (!location) return this.requestLocation(ctx, requestId, this.t('location.none'));

    await this.trips.sendPin(ctx, location.latitude, location.longitude).catch((error: Error) =>
      this.logger.warn(`Could not send driver location to ${ctx.userId}: ${error.message}`),
    );
    const [driver, history, places] = await Promise.all([
      this.trips.contact(request.driverUserId),
      this.trips.locationHistory(request.driverUserId),
      this.insights.places(request.listing),
    ]);
    const me = { lat: location.latitude, lng: location.longitude };

    // نقشه: مسیر طی‌شده در ۲۴ ساعت اخیر، موقعیت فعلی و مبدأ/مقصد بار
    await ctx.progress?.(this.t('map.drawing'));
    const trail = history.map((log) => ({ lat: log.latitude, lng: log.longitude }));
    const markers: MapMarker[] = [];
    if (places.origin) markers.push({ point: places.origin, kind: 'origin' });
    if (places.destination) markers.push({ point: places.destination, kind: 'destination' });
    markers.push({ point: me, kind: 'driver' });
    const photo = await this.mapPhoto(
      trail.length > 1 ? [{ points: [...trail, me], primary: true, color: '#7b1fa2' }] : [],
      markers,
      this.t('map.driverCaption', { driver: driver.name, time: persianDateTime(location.receivedAt ?? location.updatedAt) }),
    );

    const recent = history.slice(-RECENT_LOCATIONS).reverse();
    return {
      text: [
        this.t('location.last', { driver: this.trips.describe(driver), cargo: this.trips.cargoTitle(request) }),
        this.locationLine(location),
        recent.length > 1
          ? [
              this.t('location.recentTitle', { count: fa(history.length) }),
              ...recent.map((log) => this.t('location.recentItem', { time: persianDateTime(log.receivedAt), ago: this.ago(log.receivedAt), live: log.live ? ' 🔴' : '' })),
            ].join('\n')
          : '',
        this.t('location.mapLink', { lat: location.latitude.toFixed(6), lng: location.longitude.toFixed(6) }),
      ].filter(Boolean).join('\n\n'),
      actions: new Rows()
        .add({ id: `${Action.LocationRequest}${request.id}`, label: this.t('actions.requestFreshLocation') })
        .add(this.backToCompany(request), this.back()).actions,
      ...(photo ? { photo } : {}),
    };
  }

  private async requestLocation(ctx: BotContext, requestId: string, prefix?: string): Promise<BotReply> {
    let notice: string;
    let request: CargoRequest | null = null;
    try {
      request = await this.trips.requestLocation(ctx.userId, requestId);
      notice = this.t('location.requested');
    } catch (error) {
      notice = this.conflictText(error, 'trip');
    }
    return {
      text: [prefix, notice].filter(Boolean).join('\n\n'),
      actions: new Rows().add(
        request ? this.backToCompany(request) : { id: `${Action.CompanyTrips}1`, label: this.t('actions.companyTrips') },
        this.back(),
      ).actions,
    };
  }

  private backToCompany(request: CargoRequest): BotAction {
    return request.status === CargoRequestStatus.Pending
      ? { id: `${Action.CompanyRequests}1`, label: this.t('actions.allRequests') }
      : { id: `${Action.CompanyTrips}1`, label: this.t('actions.companyTrips') };
  }

  //#endregion

  //#region ----------- Helpers ------------------------------------------------

  /** «📍 آخرین موقعیت: ۱۴۰۵/۰۷/۱۵ ساعت ۱۴:۳۲ (۵ دقیقه پیش)» */
  private locationLine(location: DriverLocation | null): string {
    if (!location) return this.t('location.noneLine');
    const live = location.liveUntil && location.liveUntil.getTime() > Date.now();
    const at = location.receivedAt ?? location.updatedAt;
    return this.t(live ? 'location.lineLive' : 'location.line', { time: persianDateTime(at), ago: this.ago(at) });
  }

  /** خطای Conflict سرویس (taken/already/…) → متن کاربر؛ بقیه‌ی خطاها «پیدا نشد». */
  private conflictText(error: unknown, scope: string): string {
    if (error instanceof ConflictException) return this.t(`errors.${error.message}`);
    this.logger.warn(`Trip ${scope} failed: ${(error as Error).message}`);
    return this.t('notFound');
  }

  /** «۵ دقیقه پیش»، «۳ ساعت پیش»، «۲ روز پیش» */
  private ago(date: Date | string | null | undefined): string {
    if (!date) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
    if (minutes < 1) return this.t('ago.now');
    if (minutes < 60) return this.t('ago.minutes', { n: fa(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this.t('ago.hours', { n: fa(hours) });
    return this.t('ago.days', { n: fa(Math.floor(hours / 24)) });
  }

  private async hasRole(ctx: BotContext, roles: string[]): Promise<boolean> {
    const user = await this.users.findById(ctx.userId);
    return !!user?.userRoles?.some((item) => roles.includes(item.role?.name ?? ''));
  }

  private pager(prefix: string, page: number, pages: number): BotAction[] {
    const actions: BotAction[] = [];
    if (page > 1) actions.push({ id: `${prefix}${page - 1}`, label: this.t('actions.previous') });
    if (page < pages) actions.push({ id: `${prefix}${page + 1}`, label: this.t('actions.next') });
    return actions;
  }

  private back(): BotAction {
    return { id: Action.Close, label: this.t('actions.back') };
  }

  private page(value: string | undefined): number {
    const page = Number(value);
    return Number.isInteger(page) && page >= 1 ? page : 1;
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`trip.${key}`, { lang: 'fa', args }) as string;
  }

  private sessionKey(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): string {
    return RedisService.key('tripDialog', ctx.platform, ctx.externalUserId);
  }

  private getSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<TripSession | null> {
    return this.redis.getJson<TripSession>(this.sessionKey(ctx));
  }

  private saveSession(ctx: BotContext, session: TripSession): Promise<void> {
    return this.redis.setJson(this.sessionKey(ctx), session, SESSION_TTL_SECONDS);
  }

  private async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.sessionKey(ctx));
  }

  //#endregion
}
