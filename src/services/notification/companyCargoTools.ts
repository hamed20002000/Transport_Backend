import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';

import { persianTime } from 'src/domain/helper/persianDate';
import { DRIVER_KIND_LABELS, driverKindForLoad, TRIP_TYPE_LABELS } from './cargoTripType';
import { NoCargoRecipientsException } from './cargoAnnouncementError';
import { ContextManager } from 'src/application/services/agent/contextManager';
import messages from 'src/application/services/agent/localFiles/messages.json';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import {
  boolParam,
  cargoLine,
  codeParam,
  COMPANY_ROLES,
  fa,
  findMatches,
  format,
  listParam,
  numbered,
  PHONE_PATTERN,
  pickOne,
  textParam,
  ToolContext,
  ToolGenerator,
  ToolParam,
} from 'src/application/services/agent/tools/toolKit';
import { RequestResult } from 'src/application/services/agent/types';
import { CargoListingStatus } from 'src/domain/enums/notification';
import { CargoAction } from 'src/domain/constants/bot/CargoAction';
import { CargoListingService } from './cargoListing.service';
import { CargoTripService, OFFER_TTL_MINUTES } from './cargoTrip.service';
import { DriverCard } from '../driver/driverProfile.service';
import { cargoSearchText, searchFromParams } from './cargoSearch';
import { CargoNotificationService } from './cargoNotification.service';
import { CargoExcelService, ExcelCargoRow, MAX_EXCEL_BYTES } from './cargoExcel.service';

const PAGE_SIZE = 10;
// بین این تعداد مورد آخر دنبال بار موردنظر کاربر می‌گردیم
const SEARCH_WINDOW = 50;
// ردیف‌های پیش‌نمایش و خطاهای فایل اکسل که در جواب نوشته می‌شوند
const EXCEL_SHOWN = 10;

/**
 * اولین فایل اکسلی که کاربر پیوست کرد (وب: «📎»، واتساپ: فایل با کپشن). نام فایل وب UUID.xlsx است و
 * پسوند فایل واتساپ از mimetype («…spreadsheetml.sheet»، «vnd.ms-excel»).
 */
export function attachedExcel(files: unknown): string | undefined {
  return (Array.isArray(files) ? files : []).find(
    (file): file is string => typeof file === 'string' && /\.xlsx?$|spreadsheet|ms-excel/i.test(file),
  );
}

type ListingView = Awaited<ReturnType<CargoListingService['listMine']>>['items'][number];
type SuggestionView = Awaited<ReturnType<CargoNotificationService['list']>>['items'][number];

/**
 * ابزارهای agent برای بارهای شرکت (domainهای company_suggested_cargo،
 * company_create_cargo و company_my_cargo).
 * handlerها هنگام بالا آمدن ماژول در ToolRegister ثبت می‌شوند.
 */
@Injectable()
export class CompanyCargoTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly notifications: CargoNotificationService,
    private readonly listings: CargoListingService,
    private readonly trips: CargoTripService,
    private readonly excel: CargoExcelService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    //#region ---------------- Suggested cargo ----------------------------
    this.toolRegister.register({
      functionName: 'list_company_suggested_cargo',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'list_company_suggested_cargo', param);
        ctx.requireRole(COMPANY_ROLES);
        // فقط جستجو در همین جواب؛ لیست صفحه و فیلترهای کاربر دست نمی‌خورند
        const onlyNew = boolParam(param.onlyNew) ?? false;
        const search = searchFromParams(param);
        const route = cargoSearchText(search);
        // the plain list is the bot's «بارهای پیشنهادی» page; a search stays this tool's own answer
        const menuAction = route ? undefined : `${CargoAction.Suggestions}${onlyNew ? 'u' : 'a'}:1`;

        const page = await self.notifications.list(ctx.userId, {
          unreadOnly: onlyNew,
          kind: 'suggestion',
          page: 1,
          pageSize: PAGE_SIZE,
          ...search,
        });
        if (page.items.length === 0) {
          const empty = route
            ? format(messages.suggested.noneMatching, { route })
            : onlyNew
              ? messages.suggested.noneUnread
              : messages.suggested.none;
          return ctx.done({ count: '0' }, empty, { menuAction });
        }

        const header = format(messages.suggested.header, {
          count: page.total,
          route,
          scope:
            page.total > page.items.length
              ? ` ${format(messages.suggested.shownLatest, { shown: page.items.length })}`
              : '',
        });
        const lines = page.items.map((item) => self.suggestionTitle(item));
        return ctx.done({ count: String(page.total) }, `${header}\n${numbered(lines)}`, {
          list: page.items.map((item) => ({ ...item, kind: 'cargo_suggestion' })),
          menuAction,
        });
      },
    });

    this.toolRegister.register({
      functionName: 'count_company_unread_suggestions',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'count_company_unread_suggestions', param);
        ctx.requireRole(COMPANY_ROLES);

        const { count } = await self.notifications.unreadCount(ctx.userId);
        return ctx.done(
          { count: String(count) },
          count ? format(messages.suggested.unreadCount, { count }) : messages.suggested.noneUnread,
        );
      },
    });

    this.toolRegister.register({
      functionName: 'mark_company_suggestions_read',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'mark_company_suggestions_read', param);
        ctx.requireRole(COMPANY_ROLES);

        const { updated } = await self.notifications.markRead(ctx.userId);
        return ctx.done(
          { updated: String(updated) },
          updated ? format(messages.suggested.markedRead, { count: updated }) : messages.suggested.nothingToMark,
        );
      },
    });

    this.toolRegister.register({
      functionName: 'publish_company_suggested_cargo',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'publish_company_suggested_cargo', param);
        ctx.requireRole(COMPANY_ROLES);
        const phones = listParam(param.callNumbers);
        const badPhone = phones.find((phone) => !PHONE_PATTERN.test(phone));
        if (badPhone) ctx.fail(format(messages.suggested.badPhone, { phone: badPhone }));
        const fare = textParam(param.newFare);

        // «بار با کد فلان را اعلام کن»: بدون جستجو و سؤال، همان بار
        const code = codeParam(param.code);
        if (code) return await self.publishByCode(ctx, code, fare, phones);

        //#region -------- Which suggestion ------------------------------
        const recent = await self.notifications.list(ctx.userId, {
          unreadOnly: false,
          kind: 'suggestion',
          page: 1,
          pageSize: SEARCH_WINDOW,
        });
        const candidates = recent.items.filter((item) => !item.published);
        if (candidates.length === 0) ctx.fail(messages.suggested.nothingToPublish);

        const chosen = yield* pickOne(
          candidates,
          textParam(param.suggestion),
          {
            id: (item) => item.id,
            title: (item) => self.suggestionTitle(item),
            text: (item) => `${cargoLine(item.cargo as never)} ${item.text ?? ''}`,
          },
          messages.suggested.pickToPublish,
        );
        if (!chosen) ctx.fail(messages.suggested.notPicked);
        //#endregion

        return await self.publishSuggestion(ctx, chosen.id, fare, phones);
      },
    });
    //#endregion

    //#region ---------------- New cargo ----------------------------------
    this.toolRegister.register({
      functionName: 'create_company_cargo',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'create_company_cargo', param);
        ctx.requireRole(COMPANY_ROLES);

        const phones = listParam(param.phones);
        const badPhone = phones.find((phone) => !PHONE_PATTERN.test(phone));
        if (badPhone) ctx.fail(format(messages.cargo.badPhone, { phone: badPhone }));

        // «بار با کد فلان را اعلام کن»: بار پیشنهادیِ همان کد منتشر می‌شود، نه بار تازه
        const code = codeParam(param.code);
        if (code) return await self.publishByCode(ctx, code, textParam(param.fare), phones);

        const origin = textParam(param.origin);
        // «این بارها رو اعلام کن» همراه فایل اکسل: بارهای فایل، نه یک بار تازه
        const excelFile = attachedExcel(param.files);
        if (!origin && excelFile) return yield* self.importExcel(ctx, excelFile);
        if (!origin) ctx.fail(messages.cargo.originRequired);
        const destination = textParam(param.destination);
        if (!destination) ctx.fail(messages.cargo.destinationRequired);

        // نام شرکت و شماره‌ی پیش‌فرض از پروفایل، مثل فرم «ثبت بار» در وب
        const defaults = await self.listings.buildManualDraft(ctx.userId);
        const contactPhones = phones.length ? phones : defaults.contactPhones;
        if (!contactPhones.length) ctx.fail(messages.cargo.needPhone);

        const created = await ctx.call(
          self.listings.createManual(ctx.userId, {
            companyName: defaults.companyName,
            origin,
            destination,
            cargoType: textParam(param.goods) ?? null,
            weight: textParam(param.amount) ?? null,
            vehicleType: textParam(param.truck) ?? null,
            price: textParam(param.fare) ?? null,
            extraNotes: textParam(param.notes) ?? null,
            contactPhones,
          }).catch((error) => {
            if (error instanceof NoCargoRecipientsException) ctx.fail(error.message);
            throw error;
          }),
          messages.cargo.createFailed,
        );
        return ctx.done(
          { id: created.id, code: created.code ?? '', recipients: String(created.recipients) },
          created.pending
            ? ('message' in created && created.message) || format(messages.cargo.queued, {
                cargo: cargoLine(created),
                code: created.code ?? '',
                time: created.nextAnnounceAt ? persianTime(created.nextAnnounceAt) : '',
              })
            : format(messages.cargo.created, {
                cargo: cargoLine(created),
                code: created.code ?? '',
                recipients: created.recipients,
                type: TRIP_TYPE_LABELS[created.tripType],
                drivers: DRIVER_KIND_LABELS[driverKindForLoad(created.tripType)],
              }),
        );
      },
    });

    // چند بار با یک فایل اکسل؛ همان بررسی و انتشار صفحه‌ی «ثبت بار» وب و گفتگوی اکسل ربات‌ها (CargoExcelService)
    this.toolRegister.register({
      functionName: 'import_company_cargo_excel',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'import_company_cargo_excel', param);
        ctx.requireRole(COMPANY_ROLES);

        const file = attachedExcel(param.files);
        // بدون فایل: ربات‌ها گفتگوی اکسل را باز می‌کنند (فایل نمونه را می‌فرستد)، وب راهنما را می‌گوید
        if (!file) return ctx.done({ attached: 'false' }, messages.excel.attach, { menuAction: CargoAction.ExcelStart });
        return yield* self.importExcel(ctx, file);
      },
    });
    //#endregion

    //#region ---------------- My published cargo --------------------------
    this.toolRegister.register({
      functionName: 'list_company_my_cargo',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'list_company_my_cargo', param);
        ctx.requireRole(COMPANY_ROLES);
        const state = textParam(param.state);
        // فقط جستجو در همین جواب؛ لیست صفحه دست نمی‌خورد
        const status =
          state === 'open' ? CargoListingStatus.Open : state === 'taken' ? CargoListingStatus.Taken : undefined;
        const search = searchFromParams(param);
        const route = cargoSearchText(search);
        // the plain list is the bot's «بارهای شرکت» page (same status tab); a search stays this tool's own answer
        const myCargoMenu = route ? undefined : `${CargoAction.MyCargo}${state === 'open' ? 'o' : state === 'taken' ? 't' : 'a'}:1`;

        const page = await self.listings.listMine(ctx.userId, {
          status,
          announcedOnly: true,
          page: 1,
          pageSize: PAGE_SIZE,
          ...search,
        });
        if (page.items.length === 0) {
          const empty = route
            ? format(messages.myCargo.noneMatching, { route })
            : status === CargoListingStatus.Open
              ? messages.myCargo.noneOpen
              : status === CargoListingStatus.Taken
                ? messages.myCargo.noneTaken
                : messages.myCargo.none;
          return ctx.done({ count: '0' }, empty, { menuAction: myCargoMenu });
        }

        const scope =
          status === CargoListingStatus.Open
            ? ` ${messages.myCargo.open}`
            : status === CargoListingStatus.Taken
              ? ` ${messages.myCargo.taken}`
              : '';
        const header = format(messages.myCargo.header, { count: page.total, route, scope });
        return ctx.done(
          { count: String(page.total) },
          `${header}\n${numbered(page.items.map((item) => self.listingTitle(item)))}`,
          { list: page.items.map((item) => ({ ...item, kind: 'cargo_listing' })), menuAction: myCargoMenu },
        );
      },
    });

    const changeStatus = (
      functionName: string,
      from: CargoListingStatus,
      to: CargoListingStatus,
      paramName: string,
      texts: { nothing: string; pick: string; done: string },
    ) =>
      this.toolRegister.register({
        functionName,
        handler: async function* (param: ToolParam): ToolGenerator {
          const ctx: ToolContext = new ToolContext(self.history, functionName, param);
          ctx.requireRole(COMPANY_ROLES);

          const page = await self.listings.listMine(ctx.userId, { status: from, page: 1, pageSize: SEARCH_WINDOW });
          if (page.items.length === 0) ctx.fail(texts.nothing);

          const chosen = yield* pickOne(
            page.items,
            textParam(param[paramName]),
            {
              id: (item) => item.id,
              title: (item) => self.listingTitle(item),
              text: (item) => `${item.code ?? ''} ${cargoLine(item)} ${item.companyName ?? ''}`,
            },
            texts.pick,
          );
          if (!chosen) ctx.fail(messages.myCargo.notPicked);

          await ctx.call(self.listings.setStatus(ctx.userId, chosen.id, to), messages.myCargo.statusFailed);
          return ctx.done(
            { id: chosen.id, code: chosen.code ?? '', status: to },
            format(texts.done, { cargo: cargoLine(chosen), code: chosen.code ?? '' }),
          );
        },
      });

    // «برداشته شد»: بار به راننده‌ای از سامانه سپرده می‌شود و بعد از تأیید راننده «برداشته شد» می‌شود
    this.toolRegister.register({
      functionName: 'mark_company_cargo_taken',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'mark_company_cargo_taken', param);
        ctx.requireRole(COMPANY_ROLES);

        const open = await self.listings.listMine(ctx.userId, { status: CargoListingStatus.Open, page: 1, pageSize: SEARCH_WINDOW });
        if (open.items.length === 0) ctx.fail(messages.myCargo.nothingOpen);
        const listing = yield* pickOne(
          open.items,
          textParam(param.listing),
          {
            id: (item) => item.id,
            title: (item) => self.listingTitle(item),
            text: (item) => `${item.code ?? ''} ${cargoLine(item)} ${item.companyName ?? ''}`,
          },
          messages.myCargo.pickTaken,
        );
        if (!listing) ctx.fail(messages.myCargo.notPicked);

        const { drivers, offer } = await ctx.call(self.trips.candidates(ctx.userId, listing.id), messages.myCargo.statusFailed);
        if (offer) ctx.fail(format(messages.myCargo.offerWaiting, { cargo: cargoLine(listing), driver: offer.driver?.name ?? '' }));

        // راننده: از درخواست‌دهنده‌ها، یا اگر کاربر موبایل/پلاک گفت، از کل راننده‌های سامانه
        const said = textParam(param.driver);
        let options: DriverCard[] = drivers;
        if (said && !findMatches(drivers, said, (d) => self.driverText(d)).length) {
          const found = await self.trips.searchDrivers(ctx.userId, listing.id, said).catch(() => []);
          if (found.length) options = found;
        }
        if (options.length === 0) ctx.fail(format(messages.myCargo.noCandidates, { cargo: cargoLine(listing) }));
        const driver = yield* pickOne(
          options,
          said,
          { id: (d) => d.userId, title: (d) => self.driverText(d), text: (d) => self.driverText(d) },
          format(messages.myCargo.pickDriver, { cargo: cargoLine(listing) }),
        );
        if (!driver) ctx.fail(messages.myCargo.notPicked);

        const answer = yield {
          type: 'selection',
          label: format(messages.myCargo.confirmOffer, { cargo: cargoLine(listing), driver: self.driverText(driver) }),
          data: [
            { id: 'yes', title: messages.myCargo.confirmOfferYes },
            { id: 'no', title: messages.myCargo.confirmOfferNo },
          ],
        };
        if (answer !== 'yes') return ctx.done({ offered: 'false' }, messages.myCargo.offerCancelled);

        await ctx.call(self.trips.offer(ctx.userId, listing.id, driver.userId), messages.myCargo.statusFailed);
        return ctx.done(
          { listingId: listing.id, driverUserId: driver.userId },
          format(messages.myCargo.offered, { cargo: cargoLine(listing), code: listing.code ?? '', driver: driver.name, minutes: OFFER_TTL_MINUTES }),
        );
      },
    });
    changeStatus('reopen_company_cargo', CargoListingStatus.Taken, CargoListingStatus.Open, 'closedListing', {
      nothing: messages.myCargo.nothingTaken,
      pick: messages.myCargo.pickReopen,
      done: messages.myCargo.reopened,
    });
    //#endregion
  }

  /**
   * بار با کدی که کاربر گفت. اگر شرکت قبلاً همین بار را اعلام کرده همان را می‌گوید؛
   * وگرنه پیشنهادِ همین کد (حتی خارج از فیلترهای فعلی) منتشر می‌شود.
   */
  private async publishByCode(ctx: ToolContext, code: string, fare: string | undefined, phones: string[]): Promise<RequestResult> {
    const mine = await this.listings.findMineByCode(ctx.userId, code);
    if (mine) {
      const template = mine.status === CargoListingStatus.Taken ? messages.byCode.taken : messages.byCode.alreadyOpen;
      ctx.fail(format(template, { code: mine.code ?? code, cargo: cargoLine(mine) }));
    }

    const suggestion = await this.notifications.findSuggestionByCode(ctx.userId, code);
    if (!suggestion) ctx.fail(format(messages.byCode.notFound, { code }));
    return this.publishSuggestion(ctx, suggestion.id, fare, phones);
  }

  /** پیشنهاد به اسم شرکت منتشر می‌شود؛ کرایه و شماره‌ای که کاربر گفت جای مقدار پیشنهاد را می‌گیرد. */
  private async publishSuggestion(ctx: ToolContext, suggestionId: string, fare: string | undefined, phones: string[]): Promise<RequestResult> {
    const draft = await ctx.call(this.listings.buildDraft(ctx.userId, suggestionId), messages.suggested.publishFailed);
    // متن پیش‌نمایش را publish خودش از روی فیلدها دوباره می‌سازد
    const fields = { ...draft, text: undefined };
    if (fare) fields.price = fare;
    if (phones.length) fields.contactPhones = phones;
    if (!fields.contactPhones?.length) ctx.fail(messages.suggested.needPhone);

    const published = await ctx.call(this.listings.publish(ctx.userId, suggestionId, fields).catch((error) => {
      if (error instanceof NoCargoRecipientsException) ctx.fail(error.message);
      throw error;
    }), messages.suggested.publishFailed);
    return ctx.done(
      { id: published.id, code: published.code ?? '', recipients: String(published.recipients) },
      ('message' in published && published.message) || format(messages.suggested.published, {
        cargo: cargoLine(published),
        code: published.code ?? '',
        recipients: published.recipients,
      }),
    );
  }

  /**
   * بارهای فایل اکسل: بررسی همه‌ی ردیف‌ها، پیش‌نمایش و سؤال، و بعد از «بله» انتشار. اگر ردیفی ایراد
   * داشته باشد هیچ باری ثبت نمی‌شود تا فرستادن دوباره‌ی فایل اصلاح‌شده بار تکراری نسازد.
   */
  private async *importExcel(ctx: ToolContext, path: string): ToolGenerator {
    const file = await readFile(path).catch(() => ctx.fail(messages.excel.unreadable));
    if (file.length > MAX_EXCEL_BYTES) ctx.fail(messages.excel.tooBig);

    let checked: Awaited<ReturnType<CargoExcelService['check']>>;
    try {
      checked = await this.excel.check(ctx.userId, file);
    } catch (error) {
      // پیام فارسی خود بررسی (ستون مبدأ نیست، فایل خالی، بیش از حد ردیف)
      if (error instanceof BadRequestException) ctx.fail(error.message);
      throw error;
    }

    const { rows, errors } = checked;
    if (errors.length) {
      const lines = errors
        .slice(0, EXCEL_SHOWN)
        .map((error) => `${format(messages.excel.errorRow, { row: fa(error.row) })}${error.column ? ` · ${error.column}` : ''}: ${error.message}`);
      ctx.fail([messages.excel.hasErrors, lines.join('\n'), this.more(errors.length), messages.excel.sendAgain].filter(Boolean).join('\n\n'));
    }

    const answer = yield {
      type: 'selection',
      label: [format(messages.excel.confirm, { count: fa(rows.length) }), numbered(rows.slice(0, EXCEL_SHOWN).map((row) => this.excelRowTitle(row))), this.more(rows.length)]
        .filter(Boolean)
        .join('\n'),
      data: [
        { id: 'yes', title: format(messages.excel.confirmYes, { count: fa(rows.length) }) },
        { id: 'no', title: messages.excel.confirmNo },
      ],
    };
    if (answer !== 'yes') return ctx.done({ published: '0' }, messages.excel.notPublished);

    const created = await ctx.call(
      this.excel.publish(ctx.userId, rows).catch((error) => {
        if (error instanceof NoCargoRecipientsException) ctx.fail(error.message);
        throw error;
      }),
      messages.excel.publishFailed,
    );
    const codes = created.slice(0, EXCEL_SHOWN).map((item) => `${item.code ?? ''} · ${item.origin} ⬅️ ${item.destination}`);
    return ctx.done(
      { published: String(created.length), codes: created.map((item) => item.code ?? '').join(',') },
      [
        format(created.some((item) => item.pending) ? messages.excel.queued : messages.excel.done, { count: fa(created.length) }),
        codes.join('\n'),
        this.more(created.length),
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  private excelRowTitle(row: ExcelCargoRow): string {
    return `${cargoLine(row.fields)}${row.tripType ? ` · ${TRIP_TYPE_LABELS[row.tripType]}` : ''}`;
  }

  /** «… و ۵ مورد دیگر» وقتی فقط EXCEL_SHOWN مورد اول نوشته شده */
  private more(total: number): string {
    return total > EXCEL_SHOWN ? format(messages.excel.more, { count: fa(total - EXCEL_SHOWN) }) : '';
  }

  private suggestionTitle(item: SuggestionView): string {
    const summary = cargoLine(item.cargo as never) || (item.text ?? '').slice(0, 60);
    const marks = `${item.isRead ? '' : messages.suggested.unreadMark}${item.published ? messages.suggested.publishedMark : ''}`;
    return `${summary}${marks}`;
  }

  /** «رضا کریمی · تریلی · 12-ع-345-67 · 0912…» برای انتخاب راننده */
  private driverText(driver: DriverCard): string {
    return [driver.name, driver.vehicleType, driver.plate, driver.mobile].filter(Boolean).join(' · ');
  }

  private listingTitle(item: ListingView): string {
    const status = item.status === CargoListingStatus.Taken ? messages.myCargo.taken : messages.myCargo.open;
    return `${cargoLine(item)}${item.code ? ` · کد ${item.code}` : ''} (${status})`;
  }
}
