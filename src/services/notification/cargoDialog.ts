import { BadRequestException, ConflictException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { PHONE_PATTERN, cargoLine, fa } from 'src/application/services/agent/tools/toolKit';
import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { CargoAlertFilter } from 'src/domain/entities/notification/CargoAlertFilter';
import { CargoListingStatus } from 'src/domain/enums/notification';
import { parsePriceToman } from 'src/domain/helper/price';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { BotAction, BotContext, BotDialog, BotDialogRegistry, BotReply } from '../messengerBot/core/botDialog';
import { RedisService } from '../redis/redis.service';
import { CargoAlertFilterInput, CargoAlertFilterService } from './cargoAlertFilter.service';
import { CargoListingService } from './cargoListing.service';
import { CargoTripService, OFFER_TTL_MINUTES } from './cargoTrip.service';
import { DriverCard, DriverProfileService } from '../driver/driverProfile.service';
import { readFile } from 'node:fs/promises';
import { CargoNotificationService } from './cargoNotification.service';
import { TripAction } from 'src/domain/constants/bot/TripAction';
import { buildCargoListingText, CargoListingFields } from './cargoNotificationText';

const PREFIX = 'cg:';
const Action = {
  Suggestions: `${PREFIX}sg:`, // + a|u (همه/خوانده‌نشده):page
  Announce: `${PREFIX}an:`, // + notificationId
  ReadAll: `${PREFIX}ra:`, // + a|u
  MyCargo: `${PREFIX}mine:`, // + a|o|t (وضعیت):page
  MarkTaken: `${PREFIX}tk:`, // + listingId:status:page
  // «برداشته شد»: انتخاب راننده‌ای که بار به او داده شد (فهرست در نشست، چون callback حداکثر ۶۴ بایت است)
  AssignPick: `${PREFIX}ap:`, // + index در drivers نشست
  AssignList: `${PREFIX}al`,
  AssignSearch: `${PREFIX}asq`,
  AssignConfirm: `${PREFIX}aok`,
  AssignCancel: `${PREFIX}ax`,
  Reopen: `${PREFIX}ro:`, // + listingId:status:page
  OpenCargo: `${PREFIX}find:`, // + page
  Create: `${PREFIX}new`,
  Skip: `${PREFIX}skip`,
  Confirm: `${PREFIX}ok`,
  Edit: `${PREFIX}edit`,
  Restart: `${PREFIX}redo`,
  Cancel: `${PREFIX}cancel`,
  Close: `${PREFIX}close`,
  Filters: `${PREFIX}fl`,
  FilterNew: `${PREFIX}fn`,
  FilterView: `${PREFIX}fv:`, // + filterId
  FilterToggle: `${PREFIX}ft:`, // + filterId
  FilterDelete: `${PREFIX}fd:`, // + filterId
  FilterDeleteYes: `${PREFIX}fy:`, // + filterId
  FilterEdit: `${PREFIX}fe:`, // + filterId:field
  FilterClear: `${PREFIX}fc`,
  FilterPick: `${PREFIX}fp:`, // + index در options جلسه (نام شرکت ممکن است از ۶۴ بایت callback بیشتر باشد)
  FilterPickDone: `${PREFIX}fok`,
  FilterCancel: `${PREFIX}fx`,
} as const;

const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];
const DRIVER_ROLES = ['DRIVER'];
const MINE_PAGE_SIZE = 6;
const SUGGESTION_PAGE_SIZE = 6;
// متن کامل هر بار (با شماره‌ها) نشان داده می‌شود؛ صفحه‌ی کوتاه‌تر خواناتر است.
const FIND_PAGE_SIZE = 3;
const MAX_FIELD_LENGTH = 200;
const SESSION_TTL_SECONDS = 30 * 60;
const CANCEL_WORDS = ['لغو', 'انصراف', 'cancel'];
// دکمه‌های هر بار/فیلتر دوتا دوتا در یک ردیف
const PER_ROW = 2;

/** فیلتر لیست پیشنهادها و وضعیت «بارهای من»، مثل Segmented در وب. */
type SuggestionFilter = 'a' | 'u';
type MineStatus = 'a' | 'o' | 't';
const MINE_STATUS: Record<MineStatus, CargoListingStatus | undefined> = {
  a: undefined,
  o: CargoListingStatus.Open,
  t: CargoListingStatus.Taken,
};

/** مرحله‌های فرم ثبت بار به ترتیب پرسیدن؛ phone فقط اگر پروفایل شماره نداشت. */
const STEPS = ['origin', 'destination', 'cargoType', 'weight', 'vehicleType', 'price', 'extraNotes', 'phone'] as const;
type Step = (typeof STEPS)[number];
const REQUIRED: Step[] = ['origin', 'destination', 'phone'];

type Draft = Partial<Record<Exclude<Step, 'phone'>, string>> & { contactPhones?: string[] };

interface CargoSession {
  kind?: 'cargo';
  /** مرحله‌ای که منتظر جوابش هستیم؛ null یعنی پیش‌نمایش (منتظر تأیید). */
  step: Step | null;
  draft: Draft;
  /** «اعلام بار»: پیشنهادی که منتشر می‌شود؛ بدون آن، بار دستی است. */
  notificationId?: string;
  code?: string | null;
  /** ویرایش پیش‌نمایش: مقدار فعلی هر مرحله نشان داده می‌شود و می‌شود نگهش داشت. */
  editing?: boolean;
  /** پیشنهادی که مبدأ/مقصد/شماره‌اش از پیام درنیامده: فقط همان‌ها پرسیده می‌شوند. */
  fillMissing?: boolean;
}

/** فیلدهای فیلتر، مثل صفحه‌ی «تنظیمات نمایش بار» وب. */
// companies فقط برای راننده: بار خام کانال‌ها که به شرکت پیشنهاد می‌شود نام شرکت ندارد.
const LIST_FIELDS = ['origins', 'destinations', 'cargoTypes', 'vehicleTypes', 'companies'] as const;
const PRICE_FIELDS = ['minPrice', 'maxPrice'] as const;
const FILTER_FIELDS = [...LIST_FIELDS, ...PRICE_FIELDS, 'label'] as const;
type ListField = (typeof LIST_FIELDS)[number];
type FilterField = (typeof FILTER_FIELDS)[number];
const MAX_FILTER_ITEMS = 50;
const MAX_FILTER_ITEM_LENGTH = 100;
const MAX_FILTER_LABEL_LENGTH = 150;
const COMPANY_OPTIONS = 20;

interface FilterSession {
  kind: 'filter';
  /** null یعنی فیلتر جدید که مرحله‌به‌مرحله پر می‌شود. */
  filterId: string | null;
  field: FilterField;
  draft: CargoAlertFilterInput;
  /** فیلتر راننده: فیلد «شرکت» هم دارد. */
  driver?: boolean;
  /** مرحله‌ی «شرکت»: شرکت‌هایی که دکمه دارند و آن‌هایی که انتخاب شده‌اند. */
  options?: string[];
  picked?: string[];
}

/** «برداشته شد»: راننده‌هایی که شرکت می‌تواند بار را به آن‌ها بسپارد. */
interface AssignSession {
  kind: 'assign';
  listingId: string;
  code: string;
  /** برگشت به همان صفحه‌ی «بارهای من» */
  mine: MineStatus;
  page: number;
  drivers: { userId: string; label: string; name: string; face: boolean; vehicle: boolean }[];
  picked?: number;
  /** منتظر موبایل یا پلاک برای جستجو */
  searching?: boolean;
}

type Session = CargoSession | FilterSession | AssignSession;

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
 * دکمه‌های بار در ربات: «بارهای شرکت» (پیشنهادهای کانال‌ها با «اعلام بار»،
 * بارهای منتشرشده با علامت برداشته‌شدن و تنظیمات فیلتر)، «ثبت بار» (فرم
 * مرحله‌به‌مرحله) و «پیدا کردن بار» راننده. روی همان سرویس‌هایی که وب و agent
 * استفاده می‌کنند؛ خروجی فقط متن و گزینه است.
 */
@Injectable()
export class CargoDialog implements BotDialog, OnModuleInit {
  private readonly logger = new Logger(CargoDialog.name);

  readonly entries: Record<string, string> = {
    [BotCallback.CompanyLoads]: `${Action.Suggestions}a:1`,
    [BotCallback.CompanyCreateLoad]: Action.Create,
    [BotCallback.DriverSearchLoads]: `${Action.OpenCargo}1`,
  };

  constructor(
    private readonly listings: CargoListingService,
    private readonly trips: CargoTripService,
    private readonly profiles: DriverProfileService,
    private readonly notifications: CargoNotificationService,
    private readonly filters: CargoAlertFilterService,
    private readonly registry: BotDialogRegistry,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * آیا این callback که اومده از اکشن های این دیالوگ هست یا نه
   * برای تشخیص هر دیالوگ پیشوند مربوط به خودش رو داره
   * @param id 
   * @returns 
   */

  //#region ------------------------------- آیا اکشن ماله من هست ---------------------
  ownsAction(id: string): boolean {
    return id.startsWith(PREFIX);
  }
  //#endregion -----------------------------------------------------------------------

  async hasSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<boolean> {
    return (await this.getSession(ctx)) !== null;
  }

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    try {
      return await this.route(ctx, id);
    } catch (error) {
      this.logger.error(`Cargo action ${id} failed for ${ctx.userId}: ${(error as Error).message}`);
      return { text: this.t('failed'), actions: [this.back()] };
    }
  }

  async handleText(ctx: BotContext, text: string): Promise<BotReply | null> {
    const session = await this.getSession(ctx);
    if (!session) return null;

    const value = text.trim();
    if (session.kind === 'assign') {
      if (!session.searching) return null;
      if (CANCEL_WORDS.includes(value.toLowerCase())) return this.assignList(ctx, { ...session, searching: false });
      return this.assignSearch(ctx, session, value);
    }
    if (session.kind === 'filter') {
      if (CANCEL_WORDS.includes(value.toLowerCase())) return this.cancelFilterEdit(ctx, session);
      return this.filterText(ctx, session, value);
    }

    if (CANCEL_WORDS.includes(value.toLowerCase())) return this.cancelCreate(ctx, session);
    // پیش‌نمایش منتظر دکمه است؛ متن جدید یعنی کاربر کار دیگری می‌خواهد.
    if (!session.step) return null;

    if (value.length > MAX_FIELD_LENGTH) {
      return this.askStep(session, this.t('create.tooLong', { max: fa(MAX_FIELD_LENGTH) }));
    }
    if (session.step === 'phone') {
      const phones = value.split(/[,،\s]+/).filter(Boolean);
      const bad = phones.find((phone) => !PHONE_PATTERN.test(phone));
      if (!phones.length || bad) return this.askStep(session, this.t('create.badPhone', { phone: bad ?? value }));
      session.draft.contactPhones = phones;
    } else {
      session.draft[session.step] = value;
    }
    return this.nextStep(ctx, session);
  }

  //#region ----------- Routing -------------------------------------------------

  private async route(ctx: BotContext, id: string): Promise<BotReply> {
    if (id === Action.Close) {
      await this.clearSession(ctx);
      return { text: '', actions: [], closed: 'exit' };
    }

    if (id.startsWith(Action.OpenCargo)) {
      return (await this.denied(ctx, DRIVER_ROLES)) ?? this.openCargoView(ctx, this.page(id.slice(Action.OpenCargo.length)));
    }

    // تنظیمات فیلتر برای شرکت و راننده
    if (id.startsWith(PREFIX + 'f')) {
      const denied = await this.denied(ctx, [...COMPANY_ROLES, ...DRIVER_ROLES]);
      if (denied) return denied;
      const reply = await this.routeFilters(ctx, id);
      if (reply) return reply;
    }

    const denied = await this.denied(ctx, COMPANY_ROLES);
    if (denied) return denied;

    if (id.startsWith(Action.Suggestions)) {
      const [filter, page] = id.slice(Action.Suggestions.length).split(':');
      return this.suggestionsView(ctx, this.suggestionFilter(filter), this.page(page));
    }
    if (id.startsWith(Action.ReadAll)) return this.readAll(ctx, this.suggestionFilter(id.slice(Action.ReadAll.length)));
    if (id.startsWith(Action.Announce)) return this.startAnnounce(ctx, id.slice(Action.Announce.length));

    if (id.startsWith(Action.MyCargo)) {
      const parts = id.slice(Action.MyCargo.length).split(':');
      // دکمه‌های قدیمی فقط شماره‌ی صفحه داشتند
      const [status, page] = parts.length === 1 ? ['a', parts[0]] : parts;
      return this.myCargoView(ctx, this.mineStatus(status), this.page(page));
    }
    if (id.startsWith(Action.MarkTaken)) return this.startAssign(ctx, id.slice(Action.MarkTaken.length));
    const assignAction =
      id.startsWith(Action.AssignPick) || ([Action.AssignList, Action.AssignSearch, Action.AssignConfirm, Action.AssignCancel] as string[]).includes(id);
    if (assignAction) {
      const assign = await this.getSession(ctx);
      if (assign?.kind !== 'assign') return this.myCargoView(ctx, 'a', 1);
      if (id === Action.AssignCancel) {
        await this.clearSession(ctx);
        return this.myCargoView(ctx, assign.mine, assign.page);
      }
      if (id === Action.AssignList) return this.assignList(ctx, { ...assign, picked: undefined, searching: false });
      if (id === Action.AssignSearch) {
        await this.saveSession(ctx, { ...assign, searching: true });
        return { text: this.t('assign.searchAsk'), actions: new Rows().add({ id: Action.AssignList, label: this.t('actions.assignBack') }).actions };
      }
      if (id === Action.AssignConfirm) return this.assignConfirm(ctx, assign);
      return this.assignDetail(ctx, assign, Number(id.slice(Action.AssignPick.length)));
    }
    if (id.startsWith(Action.Reopen))
      return this.changeStatus(ctx, id.slice(Action.Reopen.length), CargoListingStatus.Open);

    if (id === Action.Create || id === Action.Restart) {
      const current = await this.getSession(ctx);
      // «از اول» در اعلام بار یعنی همان پیشنهاد را دوباره ویرایش کن.
      if (id === Action.Restart && current?.kind !== 'filter' && current?.kind !== 'assign' && current?.notificationId) {
        return this.startAnnounce(ctx, current.notificationId);
      }
      return this.startCreate(ctx);
    }

    const session = await this.getSession(ctx);
    if (id === Action.Cancel) return this.cancelCreate(ctx, session?.kind === 'filter' || session?.kind === 'assign' ? null : session);
    if (!session || session.kind === 'filter' || session.kind === 'assign') return this.suggestionsView(ctx, 'a', 1);
    if (id === Action.Skip && session.step && this.canSkip(session)) return this.nextStep(ctx, session);
    if (id === Action.Edit && !session.step) return this.startEdit(ctx, session);
    if (id === Action.Confirm && !session.step) return this.publish(ctx, session);
    return session.step ? this.askStep(session) : this.preview(ctx, session);
  }

  private async routeFilters(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (id === Action.Filters) return this.filtersView(ctx);
    if (id === Action.FilterNew) return this.startNewFilter(ctx);
    if (id.startsWith(Action.FilterView)) return this.filterView(ctx, id.slice(Action.FilterView.length));
    if (id.startsWith(Action.FilterToggle)) return this.toggleFilter(ctx, id.slice(Action.FilterToggle.length));
    if (id.startsWith(Action.FilterDelete)) return this.confirmDeleteFilter(ctx, id.slice(Action.FilterDelete.length));
    if (id.startsWith(Action.FilterDeleteYes)) return this.deleteFilter(ctx, id.slice(Action.FilterDeleteYes.length));
    if (id.startsWith(Action.FilterEdit)) {
      const [filterId, field] = id.slice(Action.FilterEdit.length).split(':');
      return this.startFilterEdit(ctx, filterId, field);
    }

    const session = await this.getSession(ctx);
    if (session?.kind !== 'filter') {
      if (id === Action.FilterClear || id === Action.FilterCancel) return this.filtersView(ctx);
      return null;
    }
    if (id === Action.FilterCancel) return this.cancelFilterEdit(ctx, session);
    if (id === Action.FilterClear) return this.applyFilterValue(ctx, session, null);
    if (id === Action.FilterPickDone) return this.applyFilterValue(ctx, session, session.picked?.length ? session.picked : null);
    if (id.startsWith(Action.FilterPick)) return this.togglePick(ctx, session, Number(id.slice(Action.FilterPick.length)));
    return null;
  }

  //#endregion

  //#region ----------- Company: tabs ------------------------------------------

  /** دو بخش «بارهای شرکت» مثل دو تب وب؛ بخش فعلی علامت می‌خورد. */
  private tabs(current: 'suggestions' | 'mine'): BotAction[] {
    return [
      { id: `${Action.Suggestions}a:1`, label: this.selected(this.t('tabs.suggestions'), current === 'suggestions') },
      { id: `${Action.MyCargo}a:1`, label: this.selected(this.t('tabs.mine'), current === 'mine') },
    ];
  }

  private selected(label: string, on: boolean): string {
    return on ? `✓ ${label}` : label;
  }

  //#endregion

  //#region ----------- Company: suggested cargo --------------------------------

  private async suggestionsView(ctx: BotContext, filter: SuggestionFilter, page: number, notice?: string): Promise<BotReply> {
    const result = await this.notifications.list(ctx.userId, {
      unreadOnly: filter === 'u',
      kind: 'suggestion',
      page,
      pageSize: SUGGESTION_PAGE_SIZE,
    });
    const pages = Math.max(1, Math.ceil(result.total / SUGGESTION_PAGE_SIZE));
    if (page > pages && result.total > 0) return this.suggestionsView(ctx, filter, pages, notice);

    let body = this.t(filter === 'u' ? 'suggestions.emptyUnread' : 'suggestions.empty');
    const announce: BotAction[] = [];
    if (result.items.length) {
      body = result.items
        .map((item, i) => {
          const index = fa((page - 1) * SUGGESTION_PAGE_SIZE + i + 1);
          const cargo = (item.cargo ?? {}) as Parameters<typeof cargoLine>[0] & { code?: string | null };
          const marks = [
            item.isRead ? '' : this.t('suggestions.new'),
            item.published
              ? this.t('suggestions.published', {
                  status: this.t(item.published.status === CargoListingStatus.Taken ? 'mine.taken' : 'mine.open'),
                })
              : '',
          ].filter(Boolean);
          const lines = [
            `${index}. ${cargoLine(cargo) || (item.text ?? '').slice(0, 80)}`,
            cargo?.code ? this.t('suggestions.code', { code: cargo.code }) : '',
            marks.join(' · '),
          ];
          if (!item.published) {
            announce.push({ id: `${Action.Announce}${item.id}`, label: this.t('actions.announce', { index }) });
          }
          return lines.filter(Boolean).join('\n');
        })
        .join('\n\n');
      if (pages > 1) body += `\n\n${this.t('mine.page', { page: fa(page), pages: fa(pages) })}`;
    }

    const rows = new Rows()
      .add(...this.tabs('suggestions'))
      .grid(announce)
      .add(...this.pager(`${Action.Suggestions}${filter}:`, page, pages))
      .add(
        { id: `${Action.Suggestions}a:1`, label: this.selected(this.t('actions.all'), filter === 'a') },
        { id: `${Action.Suggestions}u:1`, label: this.selected(this.t('actions.unread'), filter === 'u') },
      )
      .add(
        { id: `${Action.ReadAll}${filter}`, label: this.t('actions.readAll') },
        { id: Action.Filters, label: this.t('actions.filters') },
      )
      .add({ id: Action.Create, label: this.t('actions.create') }, this.back());

    return {
      text: [notice, this.t('suggestions.title'), this.t('suggestions.hint'), body].filter(Boolean).join('\n\n'),
      actions: rows.actions,
    };
  }

  private async readAll(ctx: BotContext, filter: SuggestionFilter): Promise<BotReply> {
    const { updated } = await this.notifications.markRead(ctx.userId);
    const notice = updated ? this.t('suggestions.markedRead', { count: fa(updated) }) : this.t('suggestions.nothingToMark');
    return this.suggestionsView(ctx, filter, 1, notice);
  }

  /** «اعلام بار»: نمونه‌ی پیشنهادی (از پیام و پروفایل شرکت) پیش‌نمایش می‌شود و قابل ویرایش است. */
  private async startAnnounce(ctx: BotContext, notificationId: string): Promise<BotReply> {
    let draft: Awaited<ReturnType<CargoListingService['buildDraft']>>;
    try {
      draft = await this.listings.buildDraft(ctx.userId, notificationId);
    } catch {
      return this.suggestionsView(ctx, 'a', 1, this.t('announce.notFound'));
    }
    const value = (text: string | null | undefined) => text?.trim() || undefined;
    const session: CargoSession = {
      kind: 'cargo',
      step: null,
      notificationId,
      code: draft.code ?? null,
      draft: {
        origin: value(draft.origin),
        destination: value(draft.destination),
        cargoType: value(draft.cargoType),
        weight: value(draft.weight),
        vehicleType: value(draft.vehicleType),
        price: value(draft.price),
        extraNotes: value(draft.extraNotes),
        contactPhones: draft.contactPhones,
      },
    };
    // مبدأ/مقصد/شماره‌ای که از پیام درنیامده باید اول پرسیده شود.
    const missing = REQUIRED.find((step) => !this.currentValue(session, step));
    if (missing) {
      session.fillMissing = true;
      session.step = missing;
      await this.saveSession(ctx, session);
      return this.askStep(session, this.t('announce.missing'));
    }
    await this.saveSession(ctx, session);
    return this.preview(ctx, session);
  }

  //#endregion

  //#region ----------- Company: my cargo --------------------------------------

  private async myCargoView(ctx: BotContext, status: MineStatus, page: number, notice?: string): Promise<BotReply> {
    const result = await this.listings.listMine(ctx.userId, {
      ...(MINE_STATUS[status] ? { status: MINE_STATUS[status] } : {}),
      page,
      pageSize: MINE_PAGE_SIZE,
    });
    const pages = Math.max(1, Math.ceil(result.total / MINE_PAGE_SIZE));
    if (page > pages && result.total > 0) return this.myCargoView(ctx, status, pages, notice);

    const toggles: BotAction[] = [];
    let body = this.t(status === 'a' ? 'mine.empty' : 'mine.emptyStatus');
    if (result.items.length) {
      body = result.items
        .map((item, index) =>
          this.t('mine.item', {
            index: fa((page - 1) * MINE_PAGE_SIZE + index + 1),
            code: item.code,
            route: cargoLine(item),
            status: this.t(item.status === CargoListingStatus.Taken ? 'mine.taken' : 'mine.open'),
          }),
        )
        .join('\n\n');
      for (const item of result.items) {
        const target = `${item.id}:${status}:${page}`;
        toggles.push(
          item.status === CargoListingStatus.Taken
            ? { id: `${Action.Reopen}${target}`, label: this.t('actions.reopen', { code: item.code }) }
            : { id: `${Action.MarkTaken}${target}`, label: this.t('actions.markTaken', { code: item.code }) },
        );
      }
      if (pages > 1) body += `\n\n${this.t('mine.page', { page: fa(page), pages: fa(pages) })}`;
    }

    const rows = new Rows()
      .add(...this.tabs('mine'))
      .grid(toggles)
      .add(...this.pager(`${Action.MyCargo}${status}:`, page, pages))
      .add(
        ...(['a', 'o', 't'] as MineStatus[]).map((value) => ({
          id: `${Action.MyCargo}${value}:1`,
          label: this.selected(this.t(`actions.status.${value}`), value === status),
        })),
      )
      .add({ id: Action.Create, label: this.t('actions.create') }, this.back());

    return { text: [notice, this.t('mine.title'), body].filter(Boolean).join('\n\n'), actions: rows.actions };
  }

  private async changeStatus(ctx: BotContext, target: string, status: CargoListingStatus): Promise<BotReply> {
    const parts = target.split(':');
    const listingId = parts[0];
    // دکمه‌های قدیمی: listingId:page
    const [filter, pageText] = parts.length === 2 ? ['a', parts[1]] : [parts[1], parts[2]];
    const mine = this.mineStatus(filter);
    const page = this.page(pageText);
    try {
      const listing = await this.listings.setStatus(ctx.userId, listingId, status);
      const notice = this.t(status === CargoListingStatus.Taken ? 'mine.markedTaken' : 'mine.reopened', {
        code: listing.code,
      });
      return this.myCargoView(ctx, mine, page, notice);
    } catch {
      return this.myCargoView(ctx, mine, page, this.t('mine.notFound'));
    }
  }

  //#endregion

  //#region ----------- Company: hand the load to a driver («برداشته شد») ------

  /** راننده‌هایی که برای این بار درخواست داده‌اند؛ اگر بار منتظر تأیید راننده است، همان را می‌گوید. */
  private async startAssign(ctx: BotContext, target: string): Promise<BotReply> {
    const [listingId, filter, pageText] = target.split(':');
    const mine = this.mineStatus(filter ?? 'a');
    const page = this.page(pageText);
    try {
      const listing = await this.listings.findById(listingId);
      const { drivers, offer } = await this.trips.candidates(ctx.userId, listingId);
      if (offer) {
        const until = offer.expiresAt ? offer.expiresAt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '';
        return this.myCargoView(ctx, mine, page, this.t('assign.waiting', { code: listing?.code ?? '', driver: offer.driver?.name ?? '', until }));
      }
      const session: AssignSession = {
        kind: 'assign',
        listingId,
        code: listing?.code ?? '',
        mine,
        page,
        drivers: drivers.map((driver) => this.assignOption(driver)),
      };
      return this.assignList(ctx, session);
    } catch {
      return this.myCargoView(ctx, mine, page, this.t('mine.notFound'));
    }
  }

  private assignOption(driver: DriverCard): AssignSession['drivers'][number] {
    const vehicle = [driver.vehicleType, driver.plate].filter(Boolean).join(' · ');
    return {
      userId: driver.userId,
      name: driver.name,
      label: vehicle ? `${driver.name} · ${vehicle}` : driver.name,
      face: driver.photos.face,
      vehicle: driver.photos.vehicle,
    };
  }

  private async assignList(ctx: BotContext, session: AssignSession, notice?: string): Promise<BotReply> {
    await this.saveSession(ctx, session);
    const rows = new Rows();
    session.drivers.forEach((driver, index) => rows.add({ id: `${Action.AssignPick}${index}`, label: `${fa(index + 1)}. ${driver.label}` }));
    rows
      .add({ id: Action.AssignSearch, label: this.t('actions.assignSearch') })
      .add({ id: Action.AssignCancel, label: this.t('actions.back') });
    const body = session.drivers.length ? this.t('assign.pick') : this.t('assign.none');
    return { text: [notice, this.t('assign.title', { code: session.code }), body].filter(Boolean).join('\n\n'), actions: rows.actions };
  }

  private async assignSearch(ctx: BotContext, session: AssignSession, query: string): Promise<BotReply> {
    const found = await this.trips.searchDrivers(ctx.userId, session.listingId, query).catch(() => []);
    const known = new Set(session.drivers.map((driver) => driver.userId));
    const extra = found.filter((driver) => !known.has(driver.userId)).map((driver) => this.assignOption(driver));
    const next = { ...session, searching: false, drivers: [...session.drivers, ...extra] };
    return this.assignList(ctx, next, extra.length ? this.t('assign.found', { count: fa(extra.length) }) : this.t('assign.searchNone'));
  }

  /** مشخصات و عکس راننده با دکمه‌ی «سپردن بار». */
  private async assignDetail(ctx: BotContext, session: AssignSession, index: number): Promise<BotReply> {
    const driver = session.drivers[index];
    if (!driver) return this.assignList(ctx, session);
    await this.saveSession(ctx, { ...session, picked: index });
    const [card] = await this.profiles.cards([driver.userId]);
    const details = [
      card?.mobile && this.t('assign.mobile', { value: card.mobile }),
      card?.vehicleType && this.t('assign.vehicle', { value: [card.vehicleType, card.vehicleModel].filter(Boolean).join(' ') }),
      card?.plate && this.t('assign.plate', { value: card.plate }),
      card?.capacityTons && this.t('assign.capacity', { value: fa(card.capacityTons) }),
      card?.homeCity && this.t('assign.city', { value: card.homeCity }),
    ].filter(Boolean);
    const photo = await this.driverPhoto(driver);
    return {
      text: [this.t('assign.confirmTitle', { name: driver.name, code: session.code }), ...details, this.t('assign.confirmHint')].join('\n'),
      actions: new Rows()
        .add({ id: Action.AssignConfirm, label: this.t('actions.assignConfirm', { name: driver.name }) })
        .add({ id: Action.AssignList, label: this.t('actions.assignBack') }).actions,
      ...(photo ? { photo: { image: photo, caption: driver.name } } : {}),
    };
  }

  private async driverPhoto(driver: AssignSession['drivers'][number]): Promise<Buffer | null> {
    const kind = driver.face ? 'face' : driver.vehicle ? 'vehicle' : null;
    if (!kind) return null;
    try {
      return await readFile(await this.profiles.photoPath(driver.userId, kind));
    } catch {
      return null;
    }
  }

  private async assignConfirm(ctx: BotContext, session: AssignSession): Promise<BotReply> {
    const driver = session.picked === undefined ? undefined : session.drivers[session.picked];
    if (!driver) return this.assignList(ctx, session);
    try {
      await this.trips.offer(ctx.userId, session.listingId, driver.userId);
      await this.clearSession(ctx);
      return this.myCargoView(ctx, session.mine, session.page, this.t('assign.offered', { name: driver.name, minutes: fa(OFFER_TTL_MINUTES) }));
    } catch (error) {
      const code = error instanceof ConflictException ? String(error.message) : '';
      return this.assignList(ctx, { ...session, picked: undefined }, this.t(`assign.errors.${['reserved', 'taken', 'notDriver', 'own'].includes(code) ? code : 'failed'}`));
    }
  }

  //#endregion

  //#region ----------- Company: cargo filters ---------------------------------

  private async filtersView(ctx: BotContext, notice?: string): Promise<BotReply> {
    const driver = await this.isDriver(ctx);
    const all = await this.filters.list(ctx.userId);
    let body = this.t('filters.empty');
    if (all.length) {
      body = all
        .map((filter, index) => `${fa(index + 1)}. ${this.filterName(filter)} — ${this.filterState(filter)}\n${this.filterSummary(filter, driver)}`)
        .join('\n\n');
    }
    const open = all.map((filter, index) => ({
      id: `${Action.FilterView}${filter.id}`,
      label: this.t('actions.filter', { index: fa(index + 1) }),
    }));
    const rows = new Rows()
      .grid(open)
      .add({ id: Action.FilterNew, label: this.t('actions.newFilter') })
      .add(
        driver
          ? { id: `${Action.OpenCargo}1`, label: this.t('actions.findCargo') }
          : { id: `${Action.Suggestions}a:1`, label: this.t('actions.suggestions') },
        this.back(),
      );
    return {
      text: [notice, this.t('filters.title'), this.t(driver ? 'filters.driverHint' : 'filters.hint'), body].filter(Boolean).join('\n\n'),
      actions: rows.actions,
    };
  }

  private async filterView(ctx: BotContext, filterId: string, notice?: string): Promise<BotReply> {
    const filter = await this.findFilter(ctx, filterId);
    if (!filter) return this.filtersView(ctx, this.t('filters.notFound'));

    const fields = this.filterFields(await this.isDriver(ctx));
    const lines = fields.map(
      (field) => `${this.t(`filters.field.${field}`)}: ${this.filterValue(filter, field) || this.t(`filters.none.${this.fieldKind(field)}`)}`,
    );
    const edits = fields.map((field) => ({
      id: `${Action.FilterEdit}${filter.id}:${field}`,
      label: this.t(`filters.field.${field}`),
    }));
    const rows = new Rows()
      .grid(edits)
      .add(
        {
          id: `${Action.FilterToggle}${filter.id}`,
          label: this.t(filter.isActive ? 'actions.deactivate' : 'actions.activate'),
        },
        { id: `${Action.FilterDelete}${filter.id}`, label: this.t('actions.delete') },
      )
      .add({ id: Action.Filters, label: this.t('actions.backToFilters') });

    const title = this.t('filters.detailTitle', { name: this.filterName(filter), state: this.filterState(filter) });
    return {
      text: [notice, title, lines.join('\n'), this.t('filters.editHint')].filter(Boolean).join('\n\n'),
      actions: rows.actions,
    };
  }

  private async toggleFilter(ctx: BotContext, filterId: string): Promise<BotReply> {
    const filter = await this.findFilter(ctx, filterId);
    if (!filter) return this.filtersView(ctx, this.t('filters.notFound'));
    await this.filters.update(ctx.userId, filter.id, { isActive: !filter.isActive });
    return this.filterView(ctx, filter.id, this.t(filter.isActive ? 'filters.deactivated' : 'filters.activated'));
  }

  private async confirmDeleteFilter(ctx: BotContext, filterId: string): Promise<BotReply> {
    const filter = await this.findFilter(ctx, filterId);
    if (!filter) return this.filtersView(ctx, this.t('filters.notFound'));
    return {
      text: this.t('filters.confirmDelete', { name: this.filterName(filter) }),
      actions: new Rows()
        .add(
          { id: `${Action.FilterDeleteYes}${filter.id}`, label: this.t('actions.confirmDelete') },
          { id: `${Action.FilterView}${filter.id}`, label: this.t('actions.cancel') },
        ).actions,
    };
  }

  private async deleteFilter(ctx: BotContext, filterId: string): Promise<BotReply> {
    try {
      await this.filters.remove(ctx.userId, filterId);
      return this.filtersView(ctx, this.t('filters.deleted'));
    } catch {
      return this.filtersView(ctx, this.t('filters.notFound'));
    }
  }

  private async startNewFilter(ctx: BotContext): Promise<BotReply> {
    const driver = await this.isDriver(ctx);
    const session: FilterSession = { kind: 'filter', filterId: null, field: this.newFilterSteps(driver)[0], draft: {}, driver };
    await this.prepareCompanies(session, []);
    await this.saveSession(ctx, session);
    return this.askFilter(session);
  }

  private async startFilterEdit(ctx: BotContext, filterId: string, field: string): Promise<BotReply> {
    if (!(FILTER_FIELDS as readonly string[]).includes(field)) return this.filterView(ctx, filterId);
    const filter = await this.findFilter(ctx, filterId);
    if (!filter) return this.filtersView(ctx, this.t('filters.notFound'));
    const session: FilterSession = { kind: 'filter', filterId, field: field as FilterField, draft: {} };
    await this.prepareCompanies(session, filter.companies ?? []);
    await this.saveSession(ctx, session);
    return this.askFilter(session, undefined, this.filterValue(filter, session.field));
  }

  private askFilter(session: FilterSession, problem?: string, current?: string): BotReply {
    const kind = this.fieldKind(session.field);
    const text = [
      problem,
      session.filterId ? '' : this.t('filters.newTitle'),
      this.t(`filters.ask.${session.field}`),
      current ? this.t('filters.current', { value: current }) : '',
    ];
    const rows = new Rows();
    if (session.field === 'companies' && session.options?.length) {
      const picked = new Set(session.picked ?? []);
      text.push(this.t('filters.pickCompanies'));
      if (picked.size) text.push(this.t('filters.picked', { value: [...picked].join('، ') }));
      rows.grid(
        session.options.map((name, index) => ({
          id: `${Action.FilterPick}${index}`,
          label: this.selected(name, picked.has(name)),
        })),
      );
      if (picked.size) rows.add({ id: Action.FilterPickDone, label: this.t('actions.savePicked') });
    } else if (session.field === 'companies') {
      text.push(this.t('filters.typeCompanies'));
    }
    rows.add(
      { id: Action.FilterClear, label: this.t(session.filterId ? `filters.clear.${kind}` : `filters.skip.${kind}`) },
      { id: Action.FilterCancel, label: this.t('actions.cancel') },
    );
    return { text: text.filter(Boolean).join('\n\n'), actions: rows.actions };
  }

  /** مرحله‌ی «شرکت»: شرکت‌هایی که بار اعلام کرده‌اند (و آن‌هایی که فیلتر از قبل دارد) دکمه می‌شوند. */
  private async prepareCompanies(session: FilterSession, current: string[]): Promise<void> {
    if (session.field !== 'companies') return;
    const recent = await this.listings.companyNames(COMPANY_OPTIONS);
    session.options = [...new Set([...current, ...recent])];
    session.picked = [...current];
  }

  private async togglePick(ctx: BotContext, session: FilterSession, index: number): Promise<BotReply> {
    const name = session.options?.[index];
    if (session.field !== 'companies' || !name) return this.askFilter(session);
    const picked = new Set(session.picked ?? []);
    if (picked.has(name)) picked.delete(name);
    else picked.add(name);
    session.picked = [...picked];
    await this.saveSession(ctx, session);
    return this.askFilter(session);
  }

  private async filterText(ctx: BotContext, session: FilterSession, value: string): Promise<BotReply> {
    const kind = this.fieldKind(session.field);
    if (kind === 'price') {
      const amount = parsePriceToman(value);
      if (amount === null) return this.askFilter(session, this.t('filters.badPrice', { price: value }));
      return this.applyFilterValue(ctx, session, amount);
    }
    if (kind === 'label') {
      if (value.length > MAX_FILTER_LABEL_LENGTH) {
        return this.askFilter(session, this.t('create.tooLong', { max: fa(MAX_FILTER_LABEL_LENGTH) }));
      }
      return this.applyFilterValue(ctx, session, value);
    }
    const typed = value.split(/[,،\n]+/).map((item) => item.trim()).filter(Boolean);
    // نام تایپ‌شده به شرکت‌هایی که با دکمه انتخاب شده اضافه می‌شود
    const items = [...new Set([...(session.field === 'companies' ? session.picked ?? [] : []), ...typed])];
    if (items.some((item) => item.length > MAX_FILTER_ITEM_LENGTH)) {
      return this.askFilter(session, this.t('create.tooLong', { max: fa(MAX_FILTER_ITEM_LENGTH) }));
    }
    if (items.length > MAX_FILTER_ITEMS) {
      return this.askFilter(session, this.t('filters.tooMany', { max: fa(MAX_FILTER_ITEMS) }));
    }
    return this.applyFilterValue(ctx, session, items);
  }

  /** null = «همه / بدون حد» (پاک کردن مقدار یا رد شدن از مرحله‌ی فیلتر جدید). */
  private async applyFilterValue(
    ctx: BotContext,
    session: FilterSession,
    value: string[] | string | number | null,
  ): Promise<BotReply> {
    const kind = this.fieldKind(session.field);
    const cleared = kind === 'list' ? [] : null;
    const input = { [session.field]: value ?? cleared } as CargoAlertFilterInput;

    if (session.filterId) {
      try {
        await this.filters.update(ctx.userId, session.filterId, input);
      } catch (error) {
        if (error instanceof BadRequestException) return this.askFilter(session, this.t('filters.badRange'));
        await this.clearSession(ctx);
        return this.filtersView(ctx, this.t('filters.notFound'));
      }
      await this.clearSession(ctx);
      return this.filterView(ctx, session.filterId, this.t('filters.saved'));
    }

    const { minPrice, maxPrice } = { ...session.draft, ...input };
    if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
      return this.askFilter(session, this.t('filters.badRange'));
    }
    Object.assign(session.draft, input);
    const steps = this.newFilterSteps(!!session.driver);
    const next = steps[steps.indexOf(session.field) + 1];
    if (next) {
      session.field = next;
      await this.prepareCompanies(session, []);
      await this.saveSession(ctx, session);
      return this.askFilter(session);
    }
    try {
      const created = await this.filters.create(ctx.userId, { ...session.draft, isActive: true });
      await this.clearSession(ctx);
      return this.filterView(ctx, created.id, this.t('filters.created'));
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      return this.askFilter(session, this.t('filters.badRange'));
    }
  }

  private async cancelFilterEdit(ctx: BotContext, session: FilterSession): Promise<BotReply> {
    await this.clearSession(ctx);
    return session.filterId ? this.filterView(ctx, session.filterId) : this.filtersView(ctx, this.t('filters.cancelled'));
  }

  private async findFilter(ctx: BotContext, filterId: string): Promise<CargoAlertFilter | undefined> {
    return (await this.filters.list(ctx.userId)).find((filter) => filter.id === filterId);
  }

  private fieldKind(field: FilterField): 'list' | 'price' | 'label' {
    if ((PRICE_FIELDS as readonly string[]).includes(field)) return 'price';
    return field === 'label' ? 'label' : 'list';
  }

  private filterValue(filter: CargoAlertFilter, field: FilterField): string {
    if (field === 'label') return filter.label ?? '';
    if (field === 'minPrice' || field === 'maxPrice') {
      const amount = filter[field];
      return amount == null ? '' : this.t('filters.toman', { amount: fa(amount.toLocaleString('en-US')) });
    }
    return (filter[field as ListField] ?? []).join('، ');
  }

  private filterName(filter: CargoAlertFilter): string {
    return filter.label || this.t('filters.unnamed');
  }

  private filterState(filter: CargoAlertFilter): string {
    return this.t(filter.isActive ? 'filters.active' : 'filters.inactive');
  }

  /** فیلدهای فیلتر برای این کاربر؛ «شرکت» فقط برای راننده. */
  private filterFields(driver: boolean): FilterField[] {
    return FILTER_FIELDS.filter((field) => driver || field !== 'companies');
  }

  /** فیلتر جدید: همین فیلدها به ترتیب؛ عنوان بعداً از صفحه‌ی فیلتر. */
  private newFilterSteps(driver: boolean): FilterField[] {
    return this.filterFields(driver).filter((field) => field !== 'label');
  }

  private async isDriver(ctx: BotContext): Promise<boolean> {
    const user = await this.users.findById(ctx.userId);
    return !!user?.userRoles?.some((item) => DRIVER_ROLES.includes(item.role?.name ?? ''));
  }

  private filterSummary(filter: CargoAlertFilter, driver: boolean): string {
    const parts = this.newFilterSteps(driver)
      .map((field) => [field, this.filterValue(filter, field)] as const)
      .filter(([, value]) => value)
      .map(([field, value]) => `${this.t(`filters.field.${field}`)}: ${value}`);
    return parts.join(' | ') || this.t('filters.any');
  }

  //#endregion

  //#region ----------- Driver: find cargo -------------------------------------

  /** بارهای باز با فیلترهای فعال خود راننده (همان‌هایی که اعلانشان برایش می‌رود). */
  private async openCargoView(ctx: BotContext, page: number): Promise<BotReply> {
    const result = await this.listings.listOpen({ page, pageSize: FIND_PAGE_SIZE, userId: ctx.userId });
    const pages = Math.max(1, Math.ceil(result.total / FIND_PAGE_SIZE));
    if (page > pages && result.total > 0) return this.openCargoView(ctx, pages);

    let body = this.t('find.empty');
    const requests: BotAction[] = [];
    if (result.items.length) {
      body = result.items
        .map((item, i) => {
          const index = fa((page - 1) * FIND_PAGE_SIZE + i + 1);
          // جزئیات: مسیرها، مسافت، سوخت، جایگاه‌ها و بار برگشتی؛ «درخواست» همان‌جاست
          requests.push({ id: `${TripAction.Detail}${item.id}`, label: this.t('actions.detail', { index }) });
          return `${index})\n${item.text}`;
        })
        .join('\n\n➖➖➖\n\n');
      if (pages > 1) body += `\n\n${this.t('find.page', { page: fa(page), pages: fa(pages) })}`;
    }
    return {
      text: `${this.t('find.title')}\n\n${body}`,
      actions: new Rows()
        .grid(requests)
        .add(...this.pager(Action.OpenCargo, page, pages))
        .add({ id: Action.Filters, label: this.t('actions.filters') }, this.back()).actions,
    };
  }

  //#endregion

  //#region ----------- Company: create / announce cargo (form) -----------------

  private async startCreate(ctx: BotContext): Promise<BotReply> {
    const session: CargoSession = { kind: 'cargo', step: 'origin', draft: {} };
    await this.saveSession(ctx, session);
    return this.askStep(session);
  }

  /** ویرایش پیش‌نمایش: همه‌ی مرحله‌ها با مقدار فعلی؛ «بدون تغییر» نگهش می‌دارد. */
  private async startEdit(ctx: BotContext, session: CargoSession): Promise<BotReply> {
    if (!session.draft.contactPhones?.length) session.draft.contactPhones = await this.defaultPhones(ctx);
    session.editing = true;
    delete session.fillMissing;
    session.step = STEPS[0];
    await this.saveSession(ctx, session);
    return this.askStep(session);
  }

  private async cancelCreate(ctx: BotContext, session: CargoSession | null): Promise<BotReply> {
    await this.clearSession(ctx);
    if (session?.notificationId) return this.suggestionsView(ctx, 'a', 1, this.t('announce.cancelled'));
    return this.myCargoView(ctx, 'a', 1, this.t('create.cancelled'));
  }

  /** مرحله‌ی بعدی که جواب ندارد؛ شماره‌ی تماس فقط اگر پروفایل نداشت پرسیده می‌شود. */
  private async nextStep(ctx: BotContext, session: CargoSession): Promise<BotReply> {
    if (session.fillMissing) {
      session.step = REQUIRED.find((step) => !this.currentValue(session, step)) ?? null;
      if (!session.step) delete session.fillMissing;
      await this.saveSession(ctx, session);
      return session.step ? this.askStep(session) : this.preview(ctx, session);
    }
    const from = session.step ? STEPS.indexOf(session.step) + 1 : STEPS.length;
    let next: Step | null = null;
    for (const step of STEPS.slice(from)) {
      if (step === 'phone' && !session.editing) {
        if (session.draft.contactPhones?.length || (await this.defaultPhones(ctx)).length) continue;
      }
      next = step;
      break;
    }
    session.step = next;
    await this.saveSession(ctx, session);
    return next ? this.askStep(session) : this.preview(ctx, session);
  }

  private currentValue(session: CargoSession, step: Step): string {
    return step === 'phone' ? (session.draft.contactPhones ?? []).join('، ') : (session.draft[step] ?? '');
  }

  private canSkip(session: CargoSession): boolean {
    const step = session.step!;
    return !REQUIRED.includes(step) || (!!session.editing && !!this.currentValue(session, step));
  }

  private askStep(session: CargoSession, problem?: string): BotReply {
    const step = session.step!;
    const current = session.editing ? this.currentValue(session, step) : '';
    const rows = new Rows();
    if (this.canSkip(session)) {
      rows.add({ id: Action.Skip, label: this.t(current ? 'actions.keep' : 'actions.skip') });
    }
    rows.add({ id: Action.Cancel, label: this.t('actions.cancel') });
    const ask = this.t(`create.ask.${step}`);
    const text = [
      problem,
      // عنوان «ثبت بار جدید» در سؤال اول فقط برای بار دستی است
      session.notificationId && step === 'origin' ? ask.split('\n\n').pop() : ask,
      current ? this.t('create.current', { value: current }) : '',
    ];
    return { text: text.filter(Boolean).join('\n\n'), actions: rows.actions };
  }

  private async preview(ctx: BotContext, session: CargoSession): Promise<BotReply> {
    const fields = await this.fields(ctx, session.draft);
    const announce = !!session.notificationId;
    const text = buildCargoListingText({ ...fields, code: session.code ?? null });
    return {
      text: this.t(announce ? 'announce.preview' : 'create.preview', { text }),
      actions: new Rows()
        .add({ id: Action.Confirm, label: this.t(announce ? 'actions.announceConfirm' : 'actions.confirm') })
        .add(
          announce
            ? { id: Action.Edit, label: this.t('actions.edit') }
            : { id: Action.Restart, label: this.t('actions.restart') },
          { id: Action.Cancel, label: this.t('actions.cancel') },
        ).actions,
    };
  }

  private async publish(ctx: BotContext, session: CargoSession): Promise<BotReply> {
    const fields = await this.fields(ctx, session.draft);
    let created: { code?: string | null; recipients: number };
    if (session.notificationId) {
      try {
        created = await this.listings.publish(ctx.userId, session.notificationId, fields);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        await this.clearSession(ctx);
        return this.suggestionsView(ctx, 'a', 1, this.t('announce.already'));
      }
    } else {
      created = await this.listings.createManual(ctx.userId, fields);
    }
    await this.clearSession(ctx);
    return {
      text: this.t(session.notificationId ? 'announce.done' : 'create.created', {
        code: created.code ?? '',
        recipients: fa(created.recipients),
      }),
      actions: new Rows()
        .add(
          { id: `${Action.Suggestions}a:1`, label: this.t('tabs.suggestions') },
          { id: `${Action.MyCargo}a:1`, label: this.t('tabs.mine') },
        )
        .add({ id: Action.Create, label: this.t('actions.create') }, this.back()).actions,
    };
  }

  /** نام شرکت و شماره‌ی پیش‌فرض از پروفایل، مثل فرم «ثبت بار» در وب و agent. */
  private async fields(ctx: BotContext, draft: Draft): Promise<CargoListingFields> {
    const defaults = await this.listings.buildManualDraft(ctx.userId);
    return {
      companyName: defaults.companyName,
      origin: draft.origin ?? '',
      destination: draft.destination ?? '',
      cargoType: draft.cargoType ?? null,
      weight: draft.weight ?? null,
      vehicleType: draft.vehicleType ?? null,
      price: draft.price ?? null,
      extraNotes: draft.extraNotes ?? null,
      contactPhones: draft.contactPhones?.length ? draft.contactPhones : defaults.contactPhones,
    };
  }

  private async defaultPhones(ctx: BotContext): Promise<string[]> {
    return (await this.listings.buildManualDraft(ctx.userId)).contactPhones;
  }

  //#endregion

  //#region ----------- Helpers ------------------------------------------------

  private async denied(ctx: BotContext, roles: string[]): Promise<BotReply | null> {
    const user = await this.users.findById(ctx.userId);
    const names = user?.userRoles?.map((item) => item.role?.name).filter(Boolean) ?? [];
    if (names.some((name) => roles.includes(name))) return null;
    await this.clearSession(ctx);
    return { text: this.t(roles === DRIVER_ROLES ? 'onlyDriver' : 'onlyCompany'), actions: [], closed: 'denied' };
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

  private suggestionFilter(value: string | undefined): SuggestionFilter {
    return value === 'u' ? 'u' : 'a';
  }

  private mineStatus(value: string | undefined): MineStatus {
    return value === 'o' || value === 't' ? value : 'a';
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`cargo.${key}`, { lang: 'fa', args }) as string;
  }

  /**
   *  کلید نشست رو برای این دیالوگ میسازد 
   * @param ctx 
   * @returns 
   */

  //#region -----------------------------  ساختن کلید نشست برای دیالوگ -------------------
  private sessionKey(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): string {
    return RedisService.key('cargoDialog', ctx.platform, ctx.externalUserId);
  }
  //#endregion ----------------------------------------------------------------------------


  /**
   * نشست رو برای دیالوگ از ردیس برمیگردونه
   * @param ctx 
   * @returns 
   */

  //#region --------------------------- به دست آوردن نشست دیالوگ -----------------------------
  private getSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<Session | null> {
    return this.redis.getJson<Session>(this.sessionKey(ctx));
  }
  //#endregion --------------------------------------------------------------------------------

  /**
   * نشست برای دیالوگ در ردیس ذخیره میشه
   * @param ctx 
   * @param session 
   * @returns 
   */

  //#region ----------------------------- ذخیره نشست برای دیالوگ --------------------------------
  private saveSession(ctx: BotContext, session: Session): Promise<void> {
    return this.redis.setJson(this.sessionKey(ctx), session, SESSION_TTL_SECONDS);
  }
  //#endregion ----------------------------------------------------------------------------------

  /**
   * نشست رو برای دیالوگ پاک میکنه
   * @param ctx 
   */

  //#region -------------------------------  پاک کردن نشست دیالوگ ---------------------------------
  private async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.sessionKey(ctx));
  }
  //#endregion -------------------------------------------------------------------------------------

  //#endregion
}
