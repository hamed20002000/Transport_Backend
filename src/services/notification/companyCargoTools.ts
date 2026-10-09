import { Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import messages from 'src/application/services/agent/localFiles/messages.json';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import {
  boolParam,
  cargoLine,
  codeParam,
  COMPANY_ROLES,
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
import { CargoListingService } from './cargoListing.service';
import { CargoNotificationService } from './cargoNotification.service';

const PAGE_SIZE = 10;
// بین این تعداد مورد آخر دنبال بار موردنظر کاربر می‌گردیم
const SEARCH_WINDOW = 50;

type ListingView = Awaited<ReturnType<CargoListingService['listMine']>>['items'][number];
type SuggestionView = Awaited<ReturnType<CargoNotificationService['list']>>['items'][number];

/**
 * ابزارهای agent برای بارهای شرکت (domainهای company_suggested_cargo،
 * company_create_cargo و company_my_cargo). مثل order.service در setash،
 * handlerها هنگام بالا آمدن ماژول در ToolRegister ثبت می‌شوند.
 */
@Injectable()
export class CompanyCargoTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly notifications: CargoNotificationService,
    private readonly listings: CargoListingService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند (الگوی setash)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    //#region ---------------- Suggested cargo ----------------------------
    this.toolRegister.register({
      functionName: 'list_company_suggested_cargo',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'list_company_suggested_cargo', param);
        ctx.requireRole(COMPANY_ROLES);
        const onlyNew = boolParam(param.onlyNew) ?? false;

        const page = await self.notifications.list(ctx.userId, {
          unreadOnly: onlyNew,
          kind: 'suggestion',
          page: 1,
          pageSize: PAGE_SIZE,
        });
        if (page.items.length === 0) {
          return ctx.done({ count: '0' }, onlyNew ? messages.suggested.noneUnread : messages.suggested.none);
        }

        const header = format(messages.suggested.header, {
          count: page.total,
          scope:
            page.total > page.items.length
              ? ` ${format(messages.suggested.shownLatest, { shown: page.items.length })}`
              : '',
        });
        const lines = page.items.map((item) => self.suggestionTitle(item));
        return ctx.done({ count: String(page.total) }, `${header}\n${numbered(lines)}`);
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
          }),
          messages.cargo.createFailed,
        );
        return ctx.done(
          { id: created.id, code: created.code ?? '', recipients: String(created.recipients) },
          format(messages.cargo.created, {
            cargo: cargoLine(created),
            code: created.code ?? '',
            recipients: created.recipients,
          }),
        );
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
        const status =
          state === 'open' ? CargoListingStatus.Open : state === 'taken' ? CargoListingStatus.Taken : undefined;

        const page = await self.listings.listMine(ctx.userId, { status, page: 1, pageSize: PAGE_SIZE });
        if (page.items.length === 0) {
          const empty =
            status === CargoListingStatus.Open
              ? messages.myCargo.noneOpen
              : status === CargoListingStatus.Taken
                ? messages.myCargo.noneTaken
                : messages.myCargo.none;
          return ctx.done({ count: '0' }, empty);
        }

        const scope =
          status === CargoListingStatus.Open
            ? ` ${messages.myCargo.open}`
            : status === CargoListingStatus.Taken
              ? ` ${messages.myCargo.taken}`
              : '';
        const header = format(messages.myCargo.header, { count: page.total, scope });
        return ctx.done(
          { count: String(page.total) },
          `${header}\n${numbered(page.items.map((item) => self.listingTitle(item)))}`,
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

    changeStatus('mark_company_cargo_taken', CargoListingStatus.Open, CargoListingStatus.Taken, 'listing', {
      nothing: messages.myCargo.nothingOpen,
      pick: messages.myCargo.pickTaken,
      done: messages.myCargo.markedTaken,
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

    const published = await ctx.call(this.listings.publish(ctx.userId, suggestionId, fields), messages.suggested.publishFailed);
    return ctx.done(
      { id: published.id, code: published.code ?? '', recipients: String(published.recipients) },
      format(messages.suggested.published, {
        cargo: cargoLine(published),
        code: published.code ?? '',
        recipients: published.recipients,
      }),
    );
  }

  private suggestionTitle(item: SuggestionView): string {
    const summary = cargoLine(item.cargo as never) || (item.text ?? '').slice(0, 60);
    const marks = `${item.isRead ? '' : messages.suggested.unreadMark}${item.published ? messages.suggested.publishedMark : ''}`;
    return `${summary}${marks}`;
  }

  private listingTitle(item: ListingView): string {
    const status = item.status === CargoListingStatus.Taken ? messages.myCargo.taken : messages.myCargo.open;
    return `${cargoLine(item)}${item.code ? ` · کد ${item.code}` : ''} (${status})`;
  }
}
