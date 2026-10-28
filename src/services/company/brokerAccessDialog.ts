import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';

import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { BotAction, BotContext, BotDialog, BotDialogRegistry, BotDocument, BotReply } from '../messengerBot/core/botDialog';
import { BROKER_ROLE } from '../notification/loadRequesters';
import { RedisService } from '../redis/redis.service';
import { receiptDir } from '../subscription/receiptStorage';
import { addCompaniesPrice, BrokerAccessService, newPeriodPrice } from './brokerAccess.service';

const PREFIX = 'ba:';
const Action = {
  List: `${PREFIX}l`,
  New: `${PREFIX}n`,
  Add: `${PREFIX}a`,
  Toggle: `${PREFIX}t`,
  Page: `${PREFIX}p`,
  Confirm: `${PREFIX}c`,
  Cancel: `${PREFIX}q`,
  Close: `${PREFIX}b`,
} as const;

/** «🔓 خرید بار شرکت‌ها» from other sections (a broker's empty load list). */
export const BROKER_ACCESS_ACTION = Action.List;

const PAGE_SIZE = 8;
const IMAGE_TYPES: Record<string, string> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' };
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_SECONDS = 30 * 60;
const currencyNames: Record<string, string> = { IRR: 'ریال', IRT: 'تومان', GBP: 'پوند', EUR: 'یورو', SAR: 'ریال سعودی', CNY: 'یوان' };
const fa = (value: number | string) => Number(value).toLocaleString('fa-IR');
const faDate = (value: Date | string) => new Date(value).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
const price = (amount: string, currency: string) => `${fa(amount)} ${currencyNames[currency] ?? currency}`;
const cardGroups = (card: string) => card.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');

/** Companies being picked; after «confirm» the receipt photo is awaited. */
interface PickSession {
  kind: 'NEW' | 'ADD';
  selected: string[];
  page: number;
  awaitingReceipt?: boolean;
}

/**
 * «🔓 خرید بار شرکت‌ها» در ربات‌ها و واتساپ برای واسط: دوره‌ی باز و قیمت‌ها، انتخاب شرکت‌ها (تازه یا افزودن به دوره‌ی باز)،
 * کارت‌به‌کارت و عکس رسید. همان BrokerAccessService پنل وب؛ نتیجه‌ی بررسی ادمین در همه‌ی کانال‌ها اعلام می‌شود.
 */
@Injectable()
export class BrokerAccessDialog implements BotDialog, OnModuleInit {
  private readonly logger = new Logger(BrokerAccessDialog.name);

  readonly entries: Record<string, string> = { [BotCallback.BrokerAccess]: Action.List };

  constructor(
    private readonly access: BrokerAccessService,
    private readonly registry: BotDialogRegistry,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly i18n: I18nService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  ownsAction(id: string): boolean {
    return id.startsWith(PREFIX);
  }

  async hasSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<boolean> {
    return !!(await this.redis.getJson<PickSession>(this.sessionKey(ctx)))?.awaitingReceipt;
  }

  async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.sessionKey(ctx));
  }

  // the receipt is a photo; text while it is awaited belongs to the other sections
  async handleText(): Promise<BotReply | null> {
    return null;
  }

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    try {
      if (id === Action.Close) {
        await this.clearSession(ctx);
        return { text: '', actions: [], closed: 'exit' };
      }
      const denied = await this.denied(ctx);
      if (denied) return denied;
      if (id === Action.Cancel) {
        await this.clearSession(ctx);
        return this.list(ctx, this.t('cancelled'));
      }
      if (id === Action.New || id === Action.Add) {
        const session: PickSession = { kind: id === Action.New ? 'NEW' : 'ADD', selected: [], page: 1 };
        return this.pick(ctx, session);
      }
      const session = await this.redis.getJson<PickSession>(this.sessionKey(ctx));
      if (session && id.startsWith(Action.Toggle)) {
        const userId = id.slice(Action.Toggle.length);
        const selected = session.selected.includes(userId) ? session.selected.filter((item) => item !== userId) : [...session.selected, userId];
        return this.pick(ctx, { ...session, selected, awaitingReceipt: false });
      }
      if (session && id.startsWith(Action.Page)) return this.pick(ctx, { ...session, page: Number(id.slice(Action.Page.length)) || 1 });
      if (session && id === Action.Confirm) return this.confirm(ctx, session);
      return this.list(ctx);
    } catch (error) {
      this.logger.error(`Broker access ${id} failed for ${ctx.userId}: ${(error as Error).message}`);
      return { text: this.t('failed'), actions: this.rows([{ id: Action.Close, label: this.t('actions.home') }]) };
    }
  }

  /** The receipt photo (a photo, or an image sent as a file) for the companies picked. */
  async handleDocument(ctx: BotContext, document: BotDocument): Promise<BotReply | null> {
    const session = await this.redis.getJson<PickSession>(this.sessionKey(ctx));
    if (!session?.awaitingReceipt) return null;
    const retry = this.rows([{ id: Action.Cancel, label: this.t('actions.cancel') }]);
    const extension = IMAGE_TYPES[document.fileName.split('.').pop()?.toLowerCase() ?? ''];
    if (!extension) return { text: this.t('notImage'), actions: retry };
    if ((document.size ?? 0) > MAX_RECEIPT_BYTES) return { text: this.t('tooBig'), actions: retry };
    const file = await document.download();
    if (file.length > MAX_RECEIPT_BYTES) return { text: this.t('tooBig'), actions: retry };

    // the private receipt store, beside the subscription receipts of the same messenger
    const path = join(receiptDir(ctx.platform), `${randomUUID()}.${extension}`);
    await writeFile(path, file);
    await this.clearSession(ctx);
    try {
      await this.access.submitOrder(ctx.userId, { kind: session.kind, companyUserIds: session.selected }, path);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) return this.list(ctx, (error as Error).message);
      throw error;
    }
    return this.list(ctx, this.t('submitted'));
  }

  //#region ----------- Pages ------------------------------------------------------

  private async list(ctx: BotContext, notice?: string): Promise<BotReply> {
    const status = await this.access.status(ctx.userId);
    const { policy } = status;
    const home = [{ id: Action.Close, label: this.t('actions.home') }];
    if (!policy.enabled) return { text: [notice, this.t('title'), this.t('free')].filter(Boolean).join('\n\n'), actions: this.rows(home) };

    const reviewing = status.orders.find((order) => order.status === 'RECEIPT_SUBMITTED');
    const names = (companies: { name: string }[]) => companies.map((company) => `• ${company.name}`).join('\n');
    const lines = [
      notice,
      this.t('title'),
      this.t('pricing', {
        count: fa(policy.includedCompanies),
        base: price(policy.basePrice, policy.currency),
        extra: price(policy.extraCompanyPrice, policy.currency),
        days: fa(policy.durationDays),
      }),
      status.period
        ? this.t('period', { date: faDate(status.period.expireAt), companies: names(status.period.companies) })
        : this.t('noPeriod'),
      status.next ? this.t('next', { date: faDate(status.next.startAt), companies: names(status.next.companies) }) : '',
      reviewing ? this.t('reviewing') : '',
    ];
    const buttons: BotAction[][] = reviewing
      ? []
      : [
          [{ id: Action.New, label: this.t(status.period ? 'actions.renew' : 'actions.buy') }],
          status.period ? [{ id: Action.Add, label: this.t('actions.add') }] : [],
        ];
    return { text: lines.filter(Boolean).join('\n\n'), actions: this.rows(...buttons, home) };
  }

  /** The companies, a page at a time: a tap selects or unselects one; the price so far is shown. */
  private async pick(ctx: BotContext, session: PickSession): Promise<BotReply> {
    const status = await this.access.status(ctx.userId);
    const { policy } = status;
    if (!policy.enabled) return this.list(ctx);
    const owned = new Set(session.kind === 'ADD' ? status.period?.companies.map((company) => company.userId) ?? [] : []);
    if (session.kind === 'ADD' && !status.period) return this.list(ctx);
    const choices = status.companies.filter((company) => !owned.has(company.userId));
    if (!choices.length) return this.list(ctx, this.t('noCompanies'));

    const pages = Math.max(1, Math.ceil(choices.length / PAGE_SIZE));
    const page = Math.min(Math.max(session.page, 1), pages);
    await this.redis.setJson(this.sessionKey(ctx), { ...session, page } satisfies PickSession, SESSION_TTL_SECONDS);

    const count = session.selected.length;
    const amount = session.kind === 'NEW' ? newPeriodPrice(policy, count) : addCompaniesPrice(policy, owned.size, count);
    const toggles = choices
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map((company) => [{ id: `${Action.Toggle}${company.userId}`, label: `${session.selected.includes(company.userId) ? '✅' : '▫️'} ${company.name}` }]);
    const pager: BotAction[] = [];
    if (page > 1) pager.push({ id: `${Action.Page}${page - 1}`, label: this.t('actions.prev') });
    if (page < pages) pager.push({ id: `${Action.Page}${page + 1}`, label: this.t('actions.next') });
    return {
      text: [
        this.t(session.kind === 'NEW' ? 'pickNew' : 'pickAdd', { count: fa(policy.includedCompanies), owned: fa(owned.size) }),
        count ? this.t('selected', { count: fa(count), price: price(amount, policy.currency) }) : '',
        pages > 1 ? this.t('page', { page: fa(page), pages: fa(pages) }) : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      actions: this.rows(
        ...toggles,
        pager,
        count ? [{ id: Action.Confirm, label: this.t('actions.confirm', { price: price(amount, policy.currency) }) }] : [],
        [{ id: Action.List, label: this.t('actions.back') }],
      ),
    };
  }

  /** A free add (room left in the base) happens at once; otherwise the card and the receipt. */
  private async confirm(ctx: BotContext, session: PickSession): Promise<BotReply> {
    if (!session.selected.length) return this.pick(ctx, session);
    const quote = await this.access.quote(ctx.userId, { kind: session.kind, companyUserIds: session.selected });
    if (quote.period && quote.amount === '0') {
      await this.access.submitOrder(ctx.userId, { kind: 'ADD', companyUserIds: session.selected }, null);
      await this.clearSession(ctx);
      return this.list(ctx, this.t('added', { count: fa(quote.companyUserIds.length) }));
    }
    const card = this.config.get<string>('CARD_NO', '');
    if (!card) return this.list(ctx, this.t('noCard'));
    await this.redis.setJson(this.sessionKey(ctx), { ...session, awaitingReceipt: true } satisfies PickSession, SESSION_TTL_SECONDS);
    return {
      text: this.t('pay', {
        count: fa(quote.companyUserIds.length),
        price: price(quote.amount, quote.policy.currency),
        card: cardGroups(card),
        owner: this.config.get<string>('CARD_OWNER', '') || '—',
      }),
      actions: this.rows([{ id: Action.Cancel, label: this.t('actions.cancel') }]),
    };
  }

  //#endregion

  private async denied(ctx: BotContext): Promise<BotReply | null> {
    const user = await this.users.findById(ctx.userId);
    if (user?.userRoles?.some((item) => item.role?.name === BROKER_ROLE)) return null;
    await this.clearSession(ctx);
    return { text: this.t('onlyBroker'), actions: [], closed: 'denied' };
  }

  /** Each array is one row of buttons (WhatsApp lists them one per line). */
  private rows(...rows: BotAction[][]): BotAction[] {
    return rows.filter((row) => row.length).flatMap((row, index) => row.map((action) => ({ ...action, row: index })));
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`brokerAccess.${key}`, { lang: 'fa', args }) as string;
  }

  private sessionKey(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): string {
    return RedisService.key('brokerAccessDialog', ctx.platform, ctx.externalUserId);
  }
}
