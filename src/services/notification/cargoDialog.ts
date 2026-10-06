import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { PHONE_PATTERN, cargoLine, fa } from 'src/application/services/agent/tools/toolKit';
import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { CargoListingStatus } from 'src/domain/enums/notification';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { BotAction, BotContext, BotDialog, BotDialogRegistry, BotReply } from '../messengerBot/core/botDialog';
import { RedisService } from '../redis/redis.service';
import { CargoListingService } from './cargoListing.service';
import { buildCargoListingText, CargoListingFields } from './cargoNotificationText';

const PREFIX = 'cg:';
const Action = {
  MyCargo: `${PREFIX}mine:`, // + page
  MarkTaken: `${PREFIX}tk:`, // + listingId:page
  Reopen: `${PREFIX}ro:`, // + listingId:page
  OpenCargo: `${PREFIX}find:`, // + page
  Create: `${PREFIX}new`,
  Skip: `${PREFIX}skip`,
  Confirm: `${PREFIX}ok`,
  Restart: `${PREFIX}redo`,
  Cancel: `${PREFIX}cancel`,
  Close: `${PREFIX}close`,
} as const;

const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];
const DRIVER_ROLES = ['DRIVER'];
const MINE_PAGE_SIZE = 5;
// متن کامل هر بار (با شماره‌ها) نشان داده می‌شود؛ صفحه‌ی کوتاه‌تر خواناتر است.
const FIND_PAGE_SIZE = 3;
const MAX_FIELD_LENGTH = 200;
const SESSION_TTL_SECONDS = 30 * 60;
const CANCEL_WORDS = ['لغو', 'انصراف', 'cancel'];

/** مرحله‌های فرم ثبت بار به ترتیب پرسیدن؛ phone فقط اگر پروفایل شماره نداشت. */
const STEPS = ['origin', 'destination', 'cargoType', 'weight', 'vehicleType', 'price', 'extraNotes', 'phone'] as const;
type Step = (typeof STEPS)[number];
const REQUIRED: Step[] = ['origin', 'destination', 'phone'];

type Draft = Partial<Record<Exclude<Step, 'phone'>, string>> & { contactPhones?: string[] };

interface CreateSession {
  /** مرحله‌ای که منتظر جوابش هستیم؛ null یعنی پیش‌نمایش (منتظر تأیید). */
  step: Step | null;
  draft: Draft;
}

/**
 * دکمه‌های بار در ربات: «بارهای شرکت» (لیست و علامت برداشته‌شدن)، «ثبت بار»
 * (فرم مرحله‌به‌مرحله) و «پیدا کردن بار» راننده. روی همان CargoListingService
 * که وب و agent استفاده می‌کنند؛ خروجی فقط متن و گزینه است.
 */
@Injectable()
export class CargoDialog implements BotDialog, OnModuleInit {
  private readonly logger = new Logger(CargoDialog.name);

  readonly entries: Record<string, string> = {
    [BotCallback.CompanyLoads]: `${Action.MyCargo}1`,
    [BotCallback.CompanyCreateLoad]: Action.Create,
    [BotCallback.DriverSearchLoads]: `${Action.OpenCargo}1`,
  };

  constructor(
    private readonly listings: CargoListingService,
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
    return (await this.getSession(ctx)) !== null;
  }

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.isAction(id)) return null;
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
    if (CANCEL_WORDS.includes(value.toLowerCase())) return this.cancelCreate(ctx);
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
      return (await this.denied(ctx, DRIVER_ROLES)) ?? this.openCargoView(this.page(id.slice(Action.OpenCargo.length)));
    }

    const denied = await this.denied(ctx, COMPANY_ROLES);
    if (denied) return denied;

    if (id.startsWith(Action.MyCargo)) return this.myCargoView(ctx, this.page(id.slice(Action.MyCargo.length)));
    if (id.startsWith(Action.MarkTaken))
      return this.changeStatus(ctx, id.slice(Action.MarkTaken.length), CargoListingStatus.Taken);
    if (id.startsWith(Action.Reopen))
      return this.changeStatus(ctx, id.slice(Action.Reopen.length), CargoListingStatus.Open);
    if (id === Action.Create || id === Action.Restart) return this.startCreate(ctx);
    if (id === Action.Cancel) return this.cancelCreate(ctx);

    const session = await this.getSession(ctx);
    if (!session) return this.myCargoView(ctx, 1);
    if (id === Action.Skip && session.step && !REQUIRED.includes(session.step)) return this.nextStep(ctx, session);
    if (id === Action.Confirm && !session.step) return this.publish(ctx, session);
    return session.step ? this.askStep(session) : this.preview(ctx, session);
  }

  //#endregion

  //#region ----------- Company: my cargo --------------------------------------

  private async myCargoView(ctx: BotContext, page: number, notice?: string): Promise<BotReply> {
    const result = await this.listings.listMine(ctx.userId, { page, pageSize: MINE_PAGE_SIZE });
    const pages = Math.max(1, Math.ceil(result.total / MINE_PAGE_SIZE));
    if (page > pages) return this.myCargoView(ctx, pages, notice);

    const actions: BotAction[] = [];
    let body = this.t('mine.empty');
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
        actions.push(
          item.status === CargoListingStatus.Taken
            ? { id: `${Action.Reopen}${item.id}:${page}`, label: this.t('actions.reopen', { code: item.code }) }
            : { id: `${Action.MarkTaken}${item.id}:${page}`, label: this.t('actions.markTaken', { code: item.code }) },
        );
      }
      if (pages > 1) body += `\n\n${this.t('mine.page', { page: fa(page), pages: fa(pages) })}`;
    }
    actions.push(...this.pager(Action.MyCargo, page, pages));
    actions.push({ id: Action.Create, label: this.t('actions.create') }, this.back());

    return { text: [notice, this.t('mine.title'), body].filter(Boolean).join('\n\n'), actions };
  }

  private async changeStatus(ctx: BotContext, target: string, status: CargoListingStatus): Promise<BotReply> {
    const [listingId, pageText] = target.split(':');
    const page = this.page(pageText);
    try {
      const listing = await this.listings.setStatus(ctx.userId, listingId, status);
      const notice = this.t(status === CargoListingStatus.Taken ? 'mine.markedTaken' : 'mine.reopened', {
        code: listing.code,
      });
      return this.myCargoView(ctx, page, notice);
    } catch {
      return this.myCargoView(ctx, page, this.t('mine.notFound'));
    }
  }

  //#endregion

  //#region ----------- Driver: find cargo -------------------------------------

  private async openCargoView(page: number): Promise<BotReply> {
    const result = await this.listings.listOpen({ page, pageSize: FIND_PAGE_SIZE });
    const pages = Math.max(1, Math.ceil(result.total / FIND_PAGE_SIZE));
    if (page > pages && result.total > 0) return this.openCargoView(pages);

    let body = this.t('find.empty');
    if (result.items.length) {
      body = result.items.map((item) => item.text).join('\n\n➖➖➖\n\n');
      if (pages > 1) body += `\n\n${this.t('find.page', { page: fa(page), pages: fa(pages) })}`;
    }
    return {
      text: `${this.t('find.title')}\n\n${body}`,
      actions: [...this.pager(Action.OpenCargo, page, pages), this.back()],
    };
  }

  //#endregion

  //#region ----------- Company: create cargo (form) ---------------------------

  private async startCreate(ctx: BotContext): Promise<BotReply> {
    const session: CreateSession = { step: 'origin', draft: {} };
    await this.saveSession(ctx, session);
    return this.askStep(session);
  }

  private async cancelCreate(ctx: BotContext): Promise<BotReply> {
    await this.clearSession(ctx);
    return this.myCargoView(ctx, 1, this.t('create.cancelled'));
  }

  /** مرحله‌ی بعدی که جواب ندارد؛ شماره‌ی تماس فقط اگر پروفایل نداشت پرسیده می‌شود. */
  private async nextStep(ctx: BotContext, session: CreateSession): Promise<BotReply> {
    const from = session.step ? STEPS.indexOf(session.step) + 1 : STEPS.length;
    let next: Step | null = null;
    for (const step of STEPS.slice(from)) {
      if (step === 'phone' && (session.draft.contactPhones?.length || (await this.defaultPhones(ctx)).length)) continue;
      next = step;
      break;
    }
    session.step = next;
    await this.saveSession(ctx, session);
    return next ? this.askStep(session) : this.preview(ctx, session);
  }

  private askStep(session: CreateSession, problem?: string): BotReply {
    const step = session.step!;
    const actions: BotAction[] = [];
    if (!REQUIRED.includes(step)) actions.push({ id: Action.Skip, label: this.t('actions.skip') });
    actions.push({ id: Action.Cancel, label: this.t('actions.cancel') });
    return { text: [problem, this.t(`create.ask.${step}`)].filter(Boolean).join('\n\n'), actions };
  }

  private async preview(ctx: BotContext, session: CreateSession): Promise<BotReply> {
    const fields = await this.fields(ctx, session.draft);
    return {
      text: this.t('create.preview', { text: buildCargoListingText(fields) }),
      actions: [
        { id: Action.Confirm, label: this.t('actions.confirm') },
        { id: Action.Restart, label: this.t('actions.restart') },
        { id: Action.Cancel, label: this.t('actions.cancel') },
      ],
    };
  }

  private async publish(ctx: BotContext, session: CreateSession): Promise<BotReply> {
    const created = await this.listings.createManual(ctx.userId, await this.fields(ctx, session.draft));
    await this.clearSession(ctx);
    return {
      text: this.t('create.created', { code: created.code, recipients: fa(created.recipients) }),
      actions: [
        { id: `${Action.MyCargo}1`, label: this.t('actions.mine') },
        { id: Action.Create, label: this.t('actions.create') },
        this.back(),
      ],
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

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`cargo.${key}`, { lang: 'fa', args }) as string;
  }

  private sessionKey(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): string {
    return RedisService.key('cargoDialog', ctx.platform, ctx.externalUserId);
  }

  private getSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<CreateSession | null> {
    return this.redis.getJson<CreateSession>(this.sessionKey(ctx));
  }

  private saveSession(ctx: BotContext, session: CreateSession): Promise<void> {
    return this.redis.setJson(this.sessionKey(ctx), session, SESSION_TTL_SECONDS);
  }

  private async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.sessionKey(ctx));
  }

  //#endregion
}
