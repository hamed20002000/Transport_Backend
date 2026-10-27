import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';

import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { BotAction, BotContext, BotDialog, BotDialogRegistry, BotDocument, BotReply } from '../messengerBot/core/botDialog';
import { RedisService } from '../redis/redis.service';
import { receiptDir } from '../subscription/receiptStorage';
import { COMPANY_ROLES, CompanyFeatureService } from './companyFeature.service';

const PREFIX = 'ft:';
const Action = {
  List: `${PREFIX}l`,
  Feature: `${PREFIX}f`,
  Plan: `${PREFIX}p`,
  Cancel: `${PREFIX}q`,
  Close: `${PREFIX}b`,
} as const;

const IMAGE_TYPES: Record<string, string> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' };
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_SECONDS = 30 * 60;
const currencyNames: Record<string, string> = { IRR: 'ریال', IRT: 'تومان', GBP: 'پوند', EUR: 'یورو', SAR: 'ریال سعودی', CNY: 'یوان' };
const fa = (value: number | string) => Number(value).toLocaleString('fa-IR');
const faDate = (value: Date | string) => new Date(value).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
const price = (amount: string, currency: string) => `${fa(amount)} ${currencyNames[currency] ?? currency}`;
const cardGroups = (card: string) => card.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');

/** A plan chosen: the receipt photo is awaited. */
interface PurchaseSession {
  planId: string;
  title: string;
}

/**
 * «💎 خرید امکانات» در ربات‌ها و واتساپ: وضعیت هر بخش پنل شرکت، انتخاب بخش و پلن، کارت‌به‌کارت و فرستادن عکس
 * رسید. همان CompanyFeatureService پنل وب؛ رسید به صف بررسی ادمین می‌رود و نتیجه در همه‌ی کانال‌ها اعلام می‌شود
 * (SubscriptionNotifier).
 */
@Injectable()
export class CompanyFeatureDialog implements BotDialog, OnModuleInit {
  private readonly logger = new Logger(CompanyFeatureDialog.name);

  readonly entries: Record<string, string> = { [BotCallback.CompanyFeatures]: Action.List };

  constructor(
    private readonly features: CompanyFeatureService,
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
    return (await this.redis.getJson<PurchaseSession>(this.sessionKey(ctx))) !== null;
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
      if (id.startsWith(Action.Feature)) return this.plans(ctx, id.slice(Action.Feature.length) as CompanyFeature);
      if (id.startsWith(Action.Plan)) return this.pay(ctx, id.slice(Action.Plan.length));
      return this.list(ctx);
    } catch (error) {
      this.logger.error(`Feature purchase ${id} failed for ${ctx.userId}: ${(error as Error).message}`);
      return { text: this.t('failed'), actions: this.rows([{ id: Action.Close, label: this.t('actions.home') }]) };
    }
  }

  /** The receipt photo (a photo, or an image sent as a file) for the plan chosen. */
  async handleDocument(ctx: BotContext, document: BotDocument): Promise<BotReply | null> {
    const session = await this.redis.getJson<PurchaseSession>(this.sessionKey(ctx));
    if (!session) return null;
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
      await this.features.submitOrder(ctx.userId, session.planId, path);
    } catch (error) {
      if (error instanceof ConflictException) return this.list(ctx, this.t('alreadyOpen', { title: session.title }));
      if (error instanceof NotFoundException) return this.list(ctx, (error as Error).message);
      throw error;
    }
    return this.list(ctx, this.t('submitted', { title: session.title }));
  }

  //#region ----------- Pages ------------------------------------------------------

  private async list(ctx: BotContext, notice?: string): Promise<BotReply> {
    const status = await this.features.status(ctx.userId);
    if (status.isParent) return { text: [notice, this.t('parent')].filter(Boolean).join('\n\n'), actions: this.rows([{ id: Action.Close, label: this.t('actions.home') }]) };
    const reviewing = new Set(status.orders.filter((order) => order.status === 'RECEIPT_SUBMITTED').map((order) => order.feature));
    const lines = status.features.map((item) => {
      if (reviewing.has(item.feature)) return this.t('status.reviewing', { title: item.title });
      if (item.expireAt) return this.t('status.open', { title: item.title, date: faDate(item.expireAt) });
      if (!item.locked) return this.t('status.free', { title: item.title });
      const cheapest = [...item.plans].sort((a, b) => Number(a.price) - Number(b.price))[0];
      const cost = cheapest ? this.t('status.from', { price: price(cheapest.price, cheapest.currency), days: fa(cheapest.durationDays) }) : this.t('status.noPlan');
      return this.t('status.locked', { title: item.title, price: cost });
    });
    // what can be bought now: a menu with plans and no receipt under review (an open one is renewed after its end)
    const buttons = status.features
      .filter((item) => item.plans.length && !reviewing.has(item.feature) && (item.locked || item.expireAt))
      .map((item) => [{ id: `${Action.Feature}${item.feature}`, label: this.t(item.expireAt ? 'actions.renew' : 'actions.buy', { title: item.title }) }]);
    return {
      text: [notice, this.t('title'), status.invited ? this.t('invitedHint') : '', lines.join('\n'), buttons.length ? this.t('pickFeature') : ''].filter(Boolean).join('\n\n'),
      actions: this.rows(...buttons, [{ id: Action.Close, label: this.t('actions.home') }]),
    };
  }

  private async plans(ctx: BotContext, feature: CompanyFeature): Promise<BotReply> {
    const item = (await this.features.status(ctx.userId)).features.find((state) => state.feature === feature);
    if (!item?.plans.length) return this.list(ctx);
    return {
      text: [this.t('pickPlan', { title: item.title }), item.expireAt ? this.t('afterCurrent') : ''].filter(Boolean).join('\n'),
      actions: this.rows(
        ...item.plans.map((plan) => [{ id: `${Action.Plan}${plan.id}`, label: this.t('actions.plan', { plan: plan.title, price: price(plan.price, plan.currency) }) }]),
        [{ id: Action.List, label: this.t('actions.back') }],
      ),
    };
  }

  private async pay(ctx: BotContext, planId: string): Promise<BotReply> {
    const item = (await this.features.status(ctx.userId)).features.find((state) => state.plans.some((plan) => plan.id === planId));
    const plan = item?.plans.find((option) => option.id === planId);
    if (!item || !plan) return this.list(ctx);
    const card = this.config.get<string>('CARD_NO', '');
    if (!card) return this.list(ctx, this.t('noCard'));
    await this.redis.setJson(this.sessionKey(ctx), { planId, title: item.title } satisfies PurchaseSession, SESSION_TTL_SECONDS);
    return {
      text: this.t('pay', {
        title: item.title,
        plan: plan.title,
        price: price(plan.price, plan.currency),
        card: cardGroups(card),
        owner: this.config.get<string>('CARD_OWNER', '') || '—',
      }),
      actions: this.rows([{ id: Action.Cancel, label: this.t('actions.cancel') }]),
    };
  }

  //#endregion

  private async denied(ctx: BotContext): Promise<BotReply | null> {
    const user = await this.users.findById(ctx.userId);
    if (user?.userRoles?.some((item) => COMPANY_ROLES.includes(item.role?.name ?? ''))) return null;
    await this.clearSession(ctx);
    return { text: this.t('onlyCompany'), actions: [], closed: 'denied' };
  }

  /** Each array is one row of buttons (WhatsApp lists them one per line). */
  private rows(...rows: BotAction[][]): BotAction[] {
    return rows.filter((row) => row.length).flatMap((row, index) => row.map((action) => ({ ...action, row: index })));
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`companyFeature.${key}`, { lang: 'fa', args }) as string;
  }

  private sessionKey(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): string {
    return RedisService.key('companyFeatureDialog', ctx.platform, ctx.externalUserId);
  }
}
