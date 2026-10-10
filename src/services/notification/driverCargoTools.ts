import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import messages from 'src/application/services/agent/localFiles/messages.json';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import {
  boolParam,
  cargoLine,
  codeParam,
  DRIVER_ROLES,
  format,
  numbered,
  pickOne,
  textParam,
  ToolContext,
  ToolGenerator,
  ToolParam,
} from 'src/application/services/agent/tools/toolKit';
import { CargoListingStatus, CargoRequestStatus } from 'src/domain/enums/notification';
import { CargoListingService } from './cargoListing.service';
import { CargoTripService } from './cargoTrip.service';
import { cargoSearchText, searchFromParams } from './cargoSearch';

const PAGE_SIZE = 10;
// بین این تعداد بار باز آخر دنبال باری که راننده توصیف کرد می‌گردیم
const SEARCH_WINDOW = 50;

// دلیل‌هایی که CargoTripService.request با ConflictException برمی‌گرداند
const REQUEST_CONFLICTS = ['taken', 'own', 'already', 'rejected'] as const;

type DriverLoad = Awaited<ReturnType<CargoTripService['listOpenForDriver']>>['items'][number];
type ListingView = NonNullable<Awaited<ReturnType<CargoListingService['findByCode']>>>;

/**
 * ابزارهای agent برای بارهای راننده (domain driver_loads): همان لیست صفحه‌ی «بارها»ی راننده
 * (CargoTripService.listOpenForDriver)؛ جواب هم متن است (تلگرام/واتس‌اپ) و هم کارت (وب).
 */
@Injectable()
export class DriverCargoTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly trips: CargoTripService,
    private readonly listings: CargoListingService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند (الگوی setash)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'list_driver_loads',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'list_driver_loads', param);
        self.requireDriver(ctx, param);

        // فقط جستجو در همین جواب؛ صفحه‌ی بارها و فیلترهای راننده دست نمی‌خورند
        const search = searchFromParams(param);
        const matchFilters = boolParam(param.onlyMyFilters) ?? false;
        const searchText = cargoSearchText(search);

        const page = await self.trips.listOpenForDriver(ctx.userId, { page: 1, pageSize: PAGE_SIZE, matchFilters, ...search });
        if (page.items.length === 0) {
          const empty = searchText
            ? format(messages.driverLoads.noneMatching, { search: searchText })
            : matchFilters
              ? messages.driverLoads.noneForFilters
              : messages.driverLoads.none;
          return ctx.done({ count: '0' }, empty);
        }

        const scope = `${matchFilters ? messages.driverLoads.byFilters : ''}${
          page.total > page.items.length ? format(messages.driverLoads.shownLatest, { shown: page.items.length }) : ''
        }`;
        const header = format(messages.driverLoads.header, { count: page.total, search: searchText, scope });
        return ctx.done(
          { count: String(page.total) },
          `${header}\n${numbered(page.items.map((item) => self.loadTitle(item)))}`,
          { list: page.items.map((item) => ({ ...item, kind: 'driver_load' })) },
        );
      },
    });

    // همان «درخواست بار» صفحه‌ی بارها: بار با کدش یا با توصیفش (مسیر، جنس، شرکت) پیدا می‌شود
    this.toolRegister.register({
      functionName: 'request_driver_load',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'request_driver_load', param);
        self.requireDriver(ctx, param);

        let listing: ListingView;
        const code = codeParam(param.code);
        if (code) {
          const found = await self.listings.findByCode(code);
          if (!found) ctx.fail(format(messages.driverLoads.codeNotFound, { code }));
          listing = found;
        } else {
          const open = await self.trips.listOpenForDriver(ctx.userId, { page: 1, pageSize: SEARCH_WINDOW });
          if (open.items.length === 0) ctx.fail(messages.driverLoads.noOpen);
          const chosen = yield* pickOne(
            open.items,
            textParam(param.load),
            {
              id: (item) => item.id,
              title: (item) => self.loadTitle(item),
              text: (item) => `${item.code ?? ''} ${cargoLine(item)} ${item.companyName ?? ''}`,
            },
            messages.driverLoads.pickRequest,
          );
          if (!chosen) ctx.fail(messages.driverLoads.notPicked);
          listing = chosen;
        }

        const cargo = cargoLine(listing);
        try {
          const request = await self.trips.request(ctx.userId, listing.id);
          // کارت همان بار با درخواست تازه، مثل صفحه بعد از زدن «درخواست بار»
          const card = { ...listing, myRequest: { id: request.id, status: request.status }, kind: 'driver_load' };
          return ctx.done(
            { id: request.id, listingId: listing.id, status: request.status },
            format(messages.driverLoads.requestSent, { cargo, code: listing.code ?? '' }),
            { list: [card] },
          );
        } catch (error) {
          const reason = error instanceof ConflictException ? error.message : '';
          const known = REQUEST_CONFLICTS.find((item) => item === reason);
          ctx.fail(known ? format(messages.driverLoads[known], { cargo }) : messages.driverLoads.requestFailed);
        }
      },
    });
  }

  private requireDriver(ctx: ToolContext, param: ToolParam): void {
    if (!(param.req.user.roles ?? []).some((role) => DRIVER_ROLES.includes(role))) ctx.fail(messages.driverLoads.notAllowed);
  }

  private loadTitle(item: DriverLoad): string {
    const status = item.myRequest?.status;
    const mark =
      status === CargoRequestStatus.Accepted
        ? messages.driverLoads.accepted
        : status === CargoRequestStatus.Pending
          ? messages.driverLoads.requested
          : item.status === CargoListingStatus.Taken
            ? ` (${messages.myCargo.taken})`
            : '';
    return `${cargoLine(item)}${item.code ? ` · کد ${item.code}` : ''}${mark}`;
  }
}
