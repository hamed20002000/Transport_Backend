import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { MessengerPlatform } from 'src/domain/enums/messenger';
import { RedisService } from '../redis/redis.service';
import { ChannelSubscriptionService, UserChannel } from './channelSubscription.service';
import { ChannelPlatform, ChannelServiceError } from './tarabariChannels.client';

/** یک گزینه؛ تلگرام آن را دکمه (callback_data = id) و واتساپ آیتم شماره‌دار نشان می‌دهد. */
export interface BotAction {
  id: string;
  label: string;
}

/**
 * پاسخ مستقل از پلتفرم. `closed`: کاربر از این بخش بیرون رفت ('exit' = خودش
 * بازگشت را زد، 'denied' = دسترسی ندارد و متن باید نمایش داده شود).
 */
export interface BotReply {
  text: string;
  actions: BotAction[];
  closed?: 'exit' | 'denied';
}

export interface BotContext {
  platform: MessengerPlatform;
  // شناسه‌ی کاربر در همان پیام‌رسان (telegramUserId یا jid واتساپ)
  externalUserId: string;
  // User.id همین سرویس، از هویت تأییدشده‌ی پیام‌رسان
  userId: string;
}

interface FlowSession {
  awaitingLink: boolean;
  // گزینه‌های آخرین پیام، برای انتخاب با شماره در واتساپ
  actions: string[];
}

const PREFIX = 'ch:';
const Action = {
  List: `${PREFIX}list`,
  Add: `${PREFIX}add`,
  Remove: `${PREFIX}rm:`,
  ConfirmRemove: `${PREFIX}rmy:`,
  Close: `${PREFIX}close`,
} as const;

// callback_data تلگرام حداکثر ۶۴ بایت است؛ پلتفرم با یک حرف ذخیره می‌شود.
const platformCode: Record<ChannelPlatform, string> = { telegram: 't', whatsapp: 'w', bale: 'b', rubika: 'r' };
const codePlatform: Record<string, ChannelPlatform> = { t: 'telegram', w: 'whatsapp', b: 'bale', r: 'rubika' };

const SESSION_TTL_SECONDS = 15 * 60;
const CANCEL_WORDS = ['لغو', 'انصراف', 'cancel', 'iptal', '0', '۰'];
const TRIGGER_WORDS = ['کانال', 'کانالها', 'کانال‌ها', 'گروه', 'گروهها', 'گروه‌ها', 'channels', '/channels'];

const latinDigits = (value: string) =>
  value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * گفتگوی «گروه‌ها و کانال‌های من» برای همه‌ی پیام‌رسان‌ها. خروجی فقط متن و
 * لیست گزینه است و هر پلتفرم خودش آن را نمایش می‌دهد؛ پس هر تغییری اینجا
 * هم‌زمان در تلگرام و واتساپ دیده می‌شود.
 */
@Injectable()
export class ChannelBotFlowService {
  constructor(
    private readonly channels: ChannelSubscriptionService,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
  ) {}

  isAction(id: string): boolean {
    return id.startsWith(PREFIX);
  }

  /** کلمه‌ای که در پیام‌رسان‌های بدون منو (واتساپ) این بخش را باز می‌کند. */
  isTrigger(text: string): boolean {
    return TRIGGER_WORDS.includes(text.trim().toLowerCase());
  }

  async hasSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<boolean> {
    return (await this.getSession(ctx)) !== null;
  }

  async open(ctx: BotContext): Promise<BotReply> {
    const denied = await this.denied(ctx);
    return denied ?? this.listView(ctx);
  }

  /** null یعنی این گزینه مال این بخش نیست. */
  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.isAction(id)) return null;

    if (id === Action.Close) {
      await this.clearSession(ctx);
      return { text: this.t('closed'), actions: [], closed: 'exit' };
    }

    const denied = await this.denied(ctx);
    if (denied) return denied;

    if (id === Action.List) return this.listView(ctx);

    if (id === Action.Add) {
      const actions = [{ id: Action.List, label: this.t('actions.cancel') }];
      await this.saveSession(ctx, { awaitingLink: true, actions: actions.map((a) => a.id) });
      return { text: this.t('askLink'), actions };
    }

    const target = this.parseTarget(id);
    if (!target) return this.listView(ctx);

    const channel = (await this.safeList(ctx.userId))?.find((c) => c.id === target.id && c.platform === target.platform);
    if (!channel) return this.listView(ctx, this.t('notFound'));
    const name = this.channelName(channel);

    if (target.confirmed) {
      try {
        await this.channels.remove(ctx.userId, channel.platform, channel.id);
        return this.listView(ctx, this.t('removed', { name }));
      } catch (error) {
        return this.listView(ctx, this.errorText(error));
      }
    }

    const actions = [
      { id: `${Action.ConfirmRemove}${platformCode[channel.platform]}:${channel.id}`, label: this.t('actions.confirmRemove') },
      { id: Action.List, label: this.t('actions.cancel') },
    ];
    await this.saveSession(ctx, { awaitingLink: false, actions: actions.map((a) => a.id) });
    return { text: this.t('confirmRemove', { name }), actions };
  }

  /**
   * متن آزاد کاربر وقتی این بخش باز است: لینک (بعد از «افزودن»)، لغو، یا در
   * واتساپ شماره‌ی گزینه. null یعنی به این بخش مربوط نیست.
   */
  async handleText(ctx: BotContext, text: string): Promise<BotReply | null> {
    const session = await this.getSession(ctx);
    if (!session) return null;
    const value = text.trim();

    if (CANCEL_WORDS.includes(value.toLowerCase())) {
      return session.awaitingLink ? this.listView(ctx) : this.handleAction(ctx, Action.Close);
    }

    if (session.awaitingLink) {
      const denied = await this.denied(ctx);
      if (denied) return denied;
      try {
        const result = await this.channels.add(ctx.userId, value);
        const notice = [this.t(result.created ? 'created' : 'alreadyRegistered'), result.warning].filter(Boolean).join('\n');
        return this.listView(ctx, notice);
      } catch (error) {
        // لینک نامعتبر: همچنان منتظر لینک می‌مانیم تا کاربر دوباره بفرستد.
        if (error instanceof ChannelServiceError && error.kind === 'invalid') {
          return { text: `${this.errorText(error)}\n\n${this.t('askLink')}`, actions: [{ id: Action.List, label: this.t('actions.cancel') }] };
        }
        return this.listView(ctx, this.errorText(error));
      }
    }

    // تلگرام دکمه دارد؛ انتخاب با شماره فقط برای پیام‌رسان‌های بدون دکمه است.
    if (ctx.platform !== MessengerPlatform.Whatsapp) return null;
    const index = Number(latinDigits(value));
    const action = Number.isInteger(index) ? session.actions[index - 1] : undefined;
    if (!action) return { text: this.t('invalidNumber'), actions: [] };
    return this.handleAction(ctx, action);
  }

  /** متن کامل برای پیام‌رسان‌های بدون دکمه: گزینه‌ها شماره‌دار زیر متن. */
  renderNumbered(reply: BotReply): string {
    if (!reply.actions.length) return reply.text;
    const lines = reply.actions.map((action, index) => `${index + 1}. ${action.label}`);
    return `${reply.text}\n\n${lines.join('\n')}\n\n${this.t('numberHint')}`;
  }

  // ------------------------------------------------------------------

  private async listView(ctx: BotContext, notice?: string): Promise<BotReply> {
    const channels = await this.safeList(ctx.userId);
    const actions: BotAction[] = [{ id: Action.Add, label: this.t('actions.add') }];

    let body: string;
    if (channels === null) {
      body = this.t('unavailable');
    } else if (!channels.length) {
      body = this.t('empty');
    } else {
      body = channels
        .map((channel, index) =>
          this.t('item', {
            index: index + 1,
            icon: channel.platform === 'telegram' ? '✈️' : '💬',
            name: this.channelName(channel),
            platform: this.t(`platform.${channel.platform}`),
            type: channel.type ? this.t(`type.${channel.type}`) : '',
            status: this.t(`status.${this.status(channel)}`),
          }),
        )
        .join('\n\n');
      for (const channel of channels) {
        actions.push({
          id: `${Action.Remove}${platformCode[channel.platform]}:${channel.id}`,
          label: this.t('actions.remove', { name: this.channelName(channel) }),
        });
      }
    }
    actions.push({ id: Action.Close, label: this.t('actions.back') });

    await this.saveSession(ctx, { awaitingLink: false, actions: actions.map((a) => a.id) });
    const text = [notice, `${this.t('title')}\n${this.t('intro')}`, body].filter(Boolean).join('\n\n');
    return { text, actions };
  }

  private async denied(ctx: BotContext): Promise<BotReply | null> {
    const access = await this.channels.checkAccess(ctx.userId);
    if (access === 'ok') return null;
    await this.clearSession(ctx);
    return { text: this.t(access === 'notCompany' ? 'onlyCompany' : 'needSubscription'), actions: [], closed: 'denied' };
  }

  private async safeList(userId: string): Promise<UserChannel[] | null> {
    try {
      return await this.channels.list(userId);
    } catch {
      return null;
    }
  }

  private parseTarget(id: string): { platform: ChannelPlatform; id: string; confirmed: boolean } | null {
    const confirmed = id.startsWith(Action.ConfirmRemove);
    if (!confirmed && !id.startsWith(Action.Remove)) return null;
    const [code, channelId] = id.slice((confirmed ? Action.ConfirmRemove : Action.Remove).length).split(':');
    const platform = codePlatform[code];
    return platform && channelId ? { platform, id: channelId, confirmed } : null;
  }

  private status(channel: UserChannel): string {
    if (!channel.isActive) return 'inactive';
    if (channel.isMember) return 'active';
    if (channel.lastError) return 'failed';
    return channel.joinRequestPending ? 'pendingApproval' : 'queued';
  }

  private channelName(channel: UserChannel): string {
    return channel.label || channel.identifier || this.t('unnamed');
  }

  private errorText(error: unknown): string {
    if (error instanceof ChannelServiceError) {
      if (error.kind === 'invalid') return /[؀-ۿ]/.test(error.message) ? `❌ ${error.message}` : this.t('invalidLink');
      if (error.kind === 'notFound') return this.t('notFound');
    }
    return this.t('unavailable');
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`channels.${key}`, { lang: 'fa', args }) as string;
  }

  private sessionKey(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): string {
    return RedisService.key('messengerChannelFlow', ctx.platform, ctx.externalUserId);
  }

  private getSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<FlowSession | null> {
    return this.redis.getJson<FlowSession>(this.sessionKey(ctx));
  }

  private saveSession(ctx: BotContext, session: FlowSession): Promise<void> {
    return this.redis.setJson(this.sessionKey(ctx), session, SESSION_TTL_SECONDS);
  }

  private async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.sessionKey(ctx));
  }
}
