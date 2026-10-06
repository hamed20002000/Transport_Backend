import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { MessengerPlatform } from 'src/domain/enums/messenger';
import { BotAction, BotContext, BotReply } from '../messengerBot/core/botDialog';
import { RedisService } from '../redis/redis.service';
import { CompanyChannelsService, UserChannel } from './companyChannels.service';
import { ChannelPlatform, ChannelServiceError } from './tarabariChannels.client';

interface DialogSession {
  awaitingLink: boolean;
  // گزینه‌های آخرین پیام، برای انتخاب با شماره در واتساپ
  actions: string[];
}

const PREFIX = 'ch:';
const Action = {
  MyChannels: `${PREFIX}list`,
  Details: `${PREFIX}v:`, // + platformCode:channelId
  Add: `${PREFIX}add`,
  Remove: `${PREFIX}rm:`,
  ConfirmRemove: `${PREFIX}rmy:`,
  Close: `${PREFIX}close`,
} as const;

// متن پیام فقط ایموجی قبول می‌کند (نه لوگو)؛ نزدیک به رنگ/شکل هر پیام‌رسان.
// Record باعث می‌شود پیام‌رسان جدید بدون ایموجی کامپایل نشود.
const platformIcon: Record<ChannelPlatform, string> = { telegram: '✈️', whatsapp: '🟢', bale: '🔵', rubika: '🟣' };

// callback_data تلگرام حداکثر ۶۴ بایت است؛ پلتفرم با یک حرف ذخیره می‌شود.
const platformCode: Record<ChannelPlatform, string> = { telegram: 't', whatsapp: 'w', bale: 'b', rubika: 'r' };
const codePlatform: Record<string, ChannelPlatform> = { t: 'telegram', w: 'whatsapp', b: 'bale', r: 'rubika' };

// کانال‌ها در ربات‌ها دوتایی در هر ردیف؛ اسم بلند دکمه را از دو ستون بیرون می‌زند.
const CHANNELS_PER_ROW = 2;
const MAX_BUTTON_NAME = 22;

const SESSION_TTL_SECONDS = 15 * 60;
const CANCEL_WORDS = ['لغو', 'انصراف', 'cancel', 'iptal', '0', '۰'];
const TRIGGER_WORDS = ['کانال', 'کانالها', 'کانال‌ها', 'گروه', 'گروهها', 'گروه‌ها', 'channels', '/channels'];

const latinDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/**
 * گفتگوی «گروه‌ها و کانال‌های من» برای همه‌ی پیام‌رسان‌ها. خروجی فقط متن و
 * لیست گزینه است و هر پلتفرم خودش آن را نمایش می‌دهد؛ پس هر تغییری اینجا
 * هم‌زمان در تلگرام و واتساپ دیده می‌شود.
 */
@Injectable()
export class CompanyChannelsDialog {
  constructor(
    private readonly channels: CompanyChannelsService,
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
    return denied ?? this.myChannelsView(ctx);
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

    if (id === Action.MyChannels) return this.myChannelsView(ctx);

    if (id === Action.Add) {
      const actions = [{ id: Action.MyChannels, label: this.t('actions.cancel') }];
      await this.saveSession(ctx, { awaitingLink: true, actions: actions.map((a) => a.id) });
      return { text: this.t('askLink'), actions };
    }

    const target = this.parseTarget(id);
    if (!target) return this.myChannelsView(ctx);

    const channel = (await this.safeList(ctx.userId))?.find(
      (c) => c.id === target.id && c.platform === target.platform,
    );
    if (!channel) return this.myChannelsView(ctx, this.t('notFound'));
    const name = this.channelName(channel);

    if (target.kind === 'details') return this.detailsView(ctx, channel);

    if (target.kind === 'confirmRemove') {
      try {
        await this.channels.remove(ctx.userId, channel.platform, channel.id);
        return this.myChannelsView(ctx, this.t('removed', { name }));
      } catch (error) {
        return this.myChannelsView(ctx, this.errorText(error));
      }
    }

    const actions = [
      { id: this.channelAction(Action.ConfirmRemove, channel), label: this.t('actions.confirmRemove'), row: 0 },
      { id: this.channelAction(Action.Details, channel), label: this.t('actions.cancel'), row: 0 },
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
      return session.awaitingLink ? this.myChannelsView(ctx) : this.handleAction(ctx, Action.Close);
    }

    if (session.awaitingLink) {
      const denied = await this.denied(ctx);
      if (denied) return denied;
      try {
        const result = await this.channels.add(ctx.userId, value);
        const notice = [this.t(result.created ? 'created' : 'alreadyRegistered'), result.warning]
          .filter(Boolean)
          .join('\n');
        return this.myChannelsView(ctx, notice);
      } catch (error) {
        // لینک نامعتبر: همچنان منتظر لینک می‌مانیم تا کاربر دوباره بفرستد.
        if (error instanceof ChannelServiceError && error.kind === 'invalid') {
          return {
            text: `${this.errorText(error)}\n\n${this.t('askLink')}`,
            actions: [{ id: Action.MyChannels, label: this.t('actions.cancel') }],
          };
        }
        return this.myChannelsView(ctx, this.errorText(error));
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

  /**
   * لیست گروه‌ها و کانال‌هایی که این کاربر ثبت کرده: راهنمای آیکون‌ها بالای
   * لیست، هر کانال یک دکمه («آیکون اسم · فعال») دوتایی در هر ردیف؛ کلیک روی
   * هر کدام جزئیات و حذف را نشان می‌دهد.
   */
  private async myChannelsView(ctx: BotContext, notice?: string): Promise<BotReply> {
    const channels = await this.safeList(ctx.userId);
    const actions: BotAction[] = [];

    let body: string;
    if (channels === null) {
      body = this.t('unavailable');
    } else if (!channels.length) {
      body = this.t('empty');
    } else {
      body = `${this.legend()}

${this.t('count', { count: channels.length })}`;
      channels.forEach((channel, index) => {
        const status = this.t(this.status(channel) === 'active' ? 'status.active' : 'status.inactive');
        actions.push({
          id: this.channelAction(Action.Details, channel),
          label: `${this.icon(channel)} ${this.shortName(channel)} · ${status}`,
          row: Math.floor(index / CHANNELS_PER_ROW),
        });
      });
    }
    const footerRow = Math.ceil((channels?.length ?? 0) / CHANNELS_PER_ROW);
    actions.push(
      { id: Action.Add, label: this.t('actions.add'), row: footerRow },
      { id: Action.Close, label: this.t('actions.back'), row: footerRow },
    );

    await this.saveSession(ctx, { awaitingLink: false, actions: actions.map((a) => a.id) });
    const text = [notice, `${this.t('title')}\n${this.t('intro')}`, body].filter(Boolean).join('\n\n');
    return { text, actions };
  }

  /** جزئیات یک گروه/کانال با دکمه‌ی حذف. */
  private async detailsView(ctx: BotContext, channel: UserChannel): Promise<BotReply> {
    const lines = [
      `${this.icon(channel)} ${this.channelName(channel)}`,
      this.t('details.platform', { platform: this.t(`platform.${channel.platform}`) }),
      channel.type ? this.t('details.type', { type: this.t(`typeName.${channel.type}`) }) : '',
      this.t('details.status', { status: this.t(`status.${this.status(channel)}`) }),
      channel.identifier ? this.t('details.identifier', { identifier: channel.identifier }) : '',
      this.t('details.createdAt', { date: this.date(channel.createdAt) }),
      channel.lastError && !channel.isMember ? this.t('details.error', { error: channel.lastError }) : '',
    ];
    const actions: BotAction[] = [
      { id: this.channelAction(Action.Remove, channel), label: this.t('actions.removeShort'), row: 0 },
      { id: Action.MyChannels, label: this.t('actions.backToList'), row: 0 },
    ];
    await this.saveSession(ctx, { awaitingLink: false, actions: actions.map((a) => a.id) });
    return { text: lines.filter(Boolean).join('\n'), actions };
  }

  /** راهنمای آیکون‌ها، تا کاربر بداند هر آیکون مال کدام پیام‌رسان است. */
  private legend(): string {
    return (Object.keys(platformIcon) as ChannelPlatform[])
      .map((platform) => `${platformIcon[platform]} ${this.t(`platform.${platform}`)}`)
      .join('   ');
  }

  private icon(channel: UserChannel): string {
    return platformIcon[channel.platform] ?? '💬';
  }

  private shortName(channel: UserChannel): string {
    const name = this.channelName(channel);
    return name.length > MAX_BUTTON_NAME ? `${name.slice(0, MAX_BUTTON_NAME - 1)}…` : name;
  }

  private channelAction(prefix: string, channel: UserChannel): string {
    return `${prefix}${platformCode[channel.platform]}:${channel.id}`;
  }

  private date(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  private async denied(ctx: BotContext): Promise<BotReply | null> {
    const access = await this.channels.checkAccess(ctx.userId);
    if (access === 'ok') return null;
    await this.clearSession(ctx);
    return {
      text: this.t(access === 'notCompany' ? 'onlyCompany' : 'needSubscription'),
      actions: [],
      closed: 'denied',
    };
  }

  private async safeList(userId: string): Promise<UserChannel[] | null> {
    try {
      return await this.channels.list(userId);
    } catch {
      return null;
    }
  }

  private parseTarget(
    id: string,
  ): { platform: ChannelPlatform; id: string; kind: 'details' | 'remove' | 'confirmRemove' } | null {
    const kinds = [
      [Action.ConfirmRemove, 'confirmRemove'],
      [Action.Remove, 'remove'],
      [Action.Details, 'details'],
    ] as const;
    const match = kinds.find(([prefix]) => id.startsWith(prefix));
    if (!match) return null;
    const [code, channelId] = id.slice(match[0].length).split(':');
    const platform = codePlatform[code];
    return platform && channelId ? { platform, id: channelId, kind: match[1] } : null;
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
    return RedisService.key('companyChannelsDialog', ctx.platform, ctx.externalUserId);
  }

  private getSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<DialogSession | null> {
    return this.redis.getJson<DialogSession>(this.sessionKey(ctx));
  }

  private saveSession(ctx: BotContext, session: DialogSession): Promise<void> {
    return this.redis.setJson(this.sessionKey(ctx), session, SESSION_TTL_SECONDS);
  }

  private async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.sessionKey(ctx));
  }
}
