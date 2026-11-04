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
import { BrokerAccessService, MAX_PACKAGES } from './brokerAccess.service';

const PREFIX = 'ba:';
const Action = {
  List: `${PREFIX}l`,
  /** picking the companies; then a company toggled (+ id), a page (+ number), and saved */
  Pick: `${PREFIX}n`,
  Toggle: `${PREFIX}t`,
  Page: `${PREFIX}p`,
  Save: `${PREFIX}s`,
  /** how many packages; then one count picked (+ count) */
  Buy: `${PREFIX}g`,
  Packages: `${PREFIX}k`,
  Cancel: `${PREFIX}q`,
  Close: `${PREFIX}b`,
} as const;

/** «🔓 شرکت‌ها و بسته‌ها» from other sections (a broker's empty load list). */
export const BROKER_ACCESS_ACTION = Action.List;

const PAGE_SIZE = 8;
// the counts offered as buttons
const PACKAGE_CHOICES = [1, 2, 3, 5, 10].filter((count) => count <= MAX_PACKAGES);
const IMAGE_TYPES: Record<string, string> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' };
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_SECONDS = 30 * 60;
const currencyNames: Record<string, string> = { IRR: 'ریال', IRT: 'تومان', GBP: 'پوند', EUR: 'یورو', SAR: 'ریال سعودی', CNY: 'یوان' };
const fa = (value: number | string) => Number(value).toLocaleString('fa-IR');
const price = (amount: string, currency: string) => `${fa(amount)} ${currencyNames[currency] ?? currency}`;
const cardGroups = (card: string) => card.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');

/** Companies being picked, or packages chosen and their receipt photo awaited. */
interface Session {
  kind: 'PICK' | 'PACKAGE';
  selected: string[];
  page: number;
  packages?: number;
  awaitingReceipt?: boolean;
}

/**
 * «🔓 شرکت‌ها و بسته‌ها» در ربات‌ها و واتساپ برای واسط: درخواست‌های مانده و خرید بسته‌ی درخواست بار (کارت‌به‌کارت و
 * عکس رسید)، و انتخاب شرکت‌هایی که بارشان را می‌بیند وقتی ادمین سقف گذاشته. همان BrokerAccessService پنل وب؛ نتیجه‌ی
 * بررسی ادمین در همه‌ی کانال‌ها اعلام می‌شود.
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
    return !!(await this.redis.getJson<Session>(this.sessionKey(ctx)))?.awaitingReceipt;
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
      if (id === Action.Buy) return this.buy(ctx);
      if (id.startsWith(Action.Packages)) return this.pay(ctx, Number(id.slice(Action.Packages.length)));
      if (id === Action.Pick) {
        const status = await this.access.status(ctx.userId);
        return this.pick(ctx, { kind: 'PICK', selected: status.selected.map((company) => company.userId), page: 1 });
      }
      const session = await this.redis.getJson<Session>(this.sessionKey(ctx));
      if (session?.kind === 'PICK') {
        if (id.startsWith(Action.Toggle)) return this.toggle(ctx, session, id.slice(Action.Toggle.length));
        if (id.startsWith(Action.Page)) return this.pick(ctx, { ...session, page: Number(id.slice(Action.Page.length)) || 1 });
        if (id === Action.Save) return this.save(ctx, session);
      }
      return this.list(ctx);
    } catch (error) {
      this.logger.error(`Broker access ${id} failed for ${ctx.userId}: ${(error as Error).message}`);
      return { text: this.t('failed'), actions: this.rows([{ id: Action.Close, label: this.t('actions.home') }]) };
    }
  }

  /** The receipt photo (a photo, or an image sent as a file) for the packages chosen. */
  async handleDocument(ctx: BotContext, document: BotDocument): Promise<BotReply | null> {
    const session = await this.redis.getJson<Session>(this.sessionKey(ctx));
    if (!session?.awaitingReceipt || !session.packages) return null;
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
      await this.access.submitPackageOrder(ctx.userId, session.packages, path);
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
    const reviewing = status.orders.some((order) => order.kind === 'PACKAGE' && order.status === 'RECEIPT_SUBMITTED');
    const lines = [notice, this.t('title')];
    if (policy.packagesEnabled) {
      lines.push(
        this.t('credit', { remaining: fa(status.remaining) }),
        this.t('package', { size: fa(policy.packageSize), price: price(policy.packagePrice, policy.currency) }),
        reviewing ? this.t('reviewing') : '',
      );
    } else {
      lines.push(this.t('freeRequests'));
    }
    if (policy.maxCompanies === null) lines.push(this.t('allCompanies'));
    else {
      lines.push(
        status.selected.length
          ? this.t('selectedCompanies', { count: fa(status.selected.length), max: fa(policy.maxCompanies), companies: status.selected.map((company) => `• ${company.name}`).join('\n') })
          : this.t('noCompanies', { max: fa(policy.maxCompanies) }),
      );
    }
    const buttons: BotAction[][] = [
      policy.packagesEnabled && !reviewing ? [{ id: Action.Buy, label: this.t('actions.buy') }] : [],
      policy.maxCompanies !== null ? [{ id: Action.Pick, label: this.t(status.selected.length ? 'actions.change' : 'actions.pick') }] : [],
    ];
    return { text: lines.filter(Boolean).join('\n\n'), actions: this.rows(...buttons, home) };
  }

  /** How many packages of load requests: a few counts, each with its price. */
  private async buy(ctx: BotContext): Promise<BotReply> {
    const { policy } = await this.access.status(ctx.userId);
    if (!policy.packagesEnabled) return this.list(ctx);
    return {
      text: [this.t('package', { size: fa(policy.packageSize), price: price(policy.packagePrice, policy.currency) }), this.t('howMany')].join('\n\n'),
      actions: this.rows(
        ...PACKAGE_CHOICES.map((count) => [{
          id: `${Action.Packages}${count}`,
          label: this.t('actions.packages', {
            count: fa(count),
            requests: fa(count * policy.packageSize),
            price: price((BigInt(policy.packagePrice) * BigInt(count)).toString(), policy.currency),
          }),
        }]),
        [{ id: Action.List, label: this.t('actions.back') }],
      ),
    };
  }

  /** The card for the packages chosen; the receipt photo is awaited. */
  private async pay(ctx: BotContext, packages: number): Promise<BotReply> {
    const { policy } = await this.access.status(ctx.userId);
    if (!policy.packagesEnabled || !Number.isInteger(packages) || packages < 1 || packages > MAX_PACKAGES) return this.list(ctx);
    const card = this.config.get<string>('CARD_NO', '');
    if (!card) return this.list(ctx, this.t('noCard'));
    await this.redis.setJson(this.sessionKey(ctx), { kind: 'PACKAGE', selected: [], page: 1, packages, awaitingReceipt: true } satisfies Session, SESSION_TTL_SECONDS);
    return {
      text: this.t('pay', {
        requests: fa(packages * policy.packageSize),
        price: price((BigInt(policy.packagePrice) * BigInt(packages)).toString(), policy.currency),
        card: cardGroups(card),
        owner: this.config.get<string>('CARD_OWNER', '') || '—',
      }),
      actions: this.rows([{ id: Action.Cancel, label: this.t('actions.cancel') }]),
    };
  }

  /** The companies, a page at a time: a tap selects or unselects one, up to the admin's limit. */
  private async pick(ctx: BotContext, session: Session, notice?: string): Promise<BotReply> {
    const status = await this.access.status(ctx.userId);
    const max = status.policy.maxCompanies;
    if (max === null) return this.list(ctx);
    if (!status.companies.length) return this.list(ctx, this.t('noChoices'));

    const pages = Math.max(1, Math.ceil(status.companies.length / PAGE_SIZE));
    const page = Math.min(Math.max(session.page, 1), pages);
    await this.redis.setJson(this.sessionKey(ctx), { ...session, page } satisfies Session, SESSION_TTL_SECONDS);

    const toggles = status.companies
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map((company) => [{ id: `${Action.Toggle}${company.userId}`, label: `${session.selected.includes(company.userId) ? '✅' : '▫️'} ${company.name}` }]);
    const pager: BotAction[] = [];
    if (page > 1) pager.push({ id: `${Action.Page}${page - 1}`, label: this.t('actions.prev') });
    if (page < pages) pager.push({ id: `${Action.Page}${page + 1}`, label: this.t('actions.next') });
    return {
      text: [
        notice,
        this.t('pickTitle', { max: fa(max) }),
        this.t('picked', { count: fa(session.selected.length), max: fa(max) }),
        pages > 1 ? this.t('page', { page: fa(page), pages: fa(pages) }) : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      actions: this.rows(
        ...toggles,
        pager,
        session.selected.length ? [{ id: Action.Save, label: this.t('actions.save') }] : [],
        [{ id: Action.List, label: this.t('actions.back') }],
      ),
    };
  }

  private async toggle(ctx: BotContext, session: Session, userId: string): Promise<BotReply> {
    if (session.selected.includes(userId)) return this.pick(ctx, { ...session, selected: session.selected.filter((item) => item !== userId) });
    const { policy } = await this.access.status(ctx.userId);
    if (policy.maxCompanies !== null && session.selected.length >= policy.maxCompanies) {
      return this.pick(ctx, session, this.t('full', { max: fa(policy.maxCompanies) }));
    }
    return this.pick(ctx, { ...session, selected: [...session.selected, userId] });
  }

  private async save(ctx: BotContext, session: Session): Promise<BotReply> {
    try {
      await this.access.selectCompanies(ctx.userId, session.selected);
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      return this.pick(ctx, session, error.message);
    }
    await this.clearSession(ctx);
    return this.list(ctx, this.t('saved', { count: fa(session.selected.length) }));
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
