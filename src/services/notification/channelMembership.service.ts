import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { ChannelMembershipChangedEvent, ChannelPlatform } from '../../domain/constants/channelEvents';
import { BOT_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { IBotLinkRepository } from '../../domain/repositories/messengerBot/IBotLinkRepository';
import { WhatsappService } from '../../application/services/agent/services/whatsapp.service';
import { MessengerBotService } from '../messengerBot/core/messengerBot.service';
import { BotPlatform } from '../messengerBot/core/botPlatform';
import { CHANNEL_STATUS_SOCKET_EVENT, NotificationsGateway } from './notifications.gateway';

type DeliveryRoute = ChannelPlatform;
const DELIVERY_ORDER: DeliveryRoute[] = ['telegram', 'whatsapp', 'bale', 'rubika'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLATFORM_LABEL: Record<ChannelPlatform, string> = {
  whatsapp: 'واتساپ',
  telegram: 'تلگرام',
  bale: 'بله',
  rubika: 'روبیکا',
};

// فقط نتیجه‌ی نهایی عضویت بیرون از پنل (پیام‌رسان‌ها) خبر داده می‌شود؛
// «منتظر تأیید» فقط در پنل نمایش داده می‌شود.
const EXTERNAL_STATUSES = new Set(['joined', 'failed', 'removed']);

export function buildChannelStatusText(event: ChannelMembershipChangedEvent): string | null {
  const kind = event.type === 'channel' ? 'کانال' : 'گروه';
  const where = `${kind} «${event.label || event.identifier || 'بدون نام'}» (${PLATFORM_LABEL[event.platform]})`;

  switch (event.status) {
    case 'joined':
      return `✅ عضویت در ${where} انجام شد.\nاز این به بعد بارهای آن برای شما ارسال می‌شود.`;
    case 'pending':
      return `⏳ درخواست عضویت در ${where} فرستاده شد و منتظر تأیید ادمین آن است.`;
    case 'failed':
      return `❌ عضویت در ${where} ممکن نشد.${event.reason ? `\nعلت: ${event.reason}` : ''}`;
    case 'removed':
      return `🚫 ربات از ${where} حذف شد و دیگر باری از آن دریافت نمی‌شود.`;
    default:
      return null;
  }
}

/**
 * اعلام تغییر وضعیت عضویت به کاربرهایی که گروه/کانال را ثبت کرده‌اند:
 *  - همیشه روی socket (اگر صفحه باز باشد، لیست همان لحظه به‌روز می‌شود)
 *  - اگر کاربر آنلاین نیست: پیام در یکی از پیام‌رسان‌ها (تلگرام، واتساپ،
 *    بله، روبیکا) -- اول همان پلتفرمِ گروه/کانال، اگر آن ممکن نبود بقیه.
 */
@Injectable()
export class ChannelMembershipNotifier {
  private readonly logger = new Logger(ChannelMembershipNotifier.name);

  constructor(
    // اتصال کاربر به ربات‌های تلگرام، بله و روبیکا (جدول BotLink، ستون platform).
    @Inject(BOT_LINK_REPOSITORY)
    private readonly botLinks: IBotLinkRepository,
    // MessengerBotService ربات هر سه پیام‌رسان را دارد و با پیشوند chatId (bale:…، rubika:…) مسیر را انتخاب می‌کند.
    private readonly bots: MessengerBotService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsapp: WhatsappService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async handle(event: ChannelMembershipChangedEvent): Promise<void> {
    const text = buildChannelStatusText(event);
    if (!text) return;

    const { ownerUserIds, ...view } = event;
    const recipients = [...new Set(ownerUserIds.filter((id) => UUID_PATTERN.test(id)))];

    for (const userId of recipients) {
      this.gateway.sendToUser(userId, CHANNEL_STATUS_SOCKET_EVENT, { ...view, text });

      if (!EXTERNAL_STATUSES.has(event.status) || (await this.gateway.isOnline(userId))) continue;
      await this.deliverOffline(userId, event, text);
    }
  }

  /**
   * اول همان پیام‌رسانِ گروه/کانال، بعد بقیه به ترتیب -- اگر یکی فیلتر یا قطع
   * بود (یا کاربر به آن وصل نبود) سراغ بعدی می‌رود. گروه‌های واتساپ/تلگرام/
   * بله/روبیکا همه همین‌طور؛ اولین ارسال موفق کافی است.
   */
  private async deliverOffline(userId: string, event: ChannelMembershipChangedEvent, text: string): Promise<void> {
    const order = [...new Set<DeliveryRoute>([event.platform, ...DELIVERY_ORDER])];

    for (const platform of order) {
      try {
        const sent =
          platform === 'whatsapp'
            ? await this.sendViaWhatsapp(userId, text)
            : await this.sendViaBot(platform, userId, text); // telegram، bale، rubika
        if (sent) return;
      } catch (error) {
        this.logger.warn(
          `Channel status (${event.status}) via ${platform} to ${userId} failed: ${(error as Error).message}`,
        );
      }
    }

    this.logger.debug(`Channel status ${event.eventId}: no messenger route for offline user ${userId}`);
  }

  /** @returns false اگر کاربر واتساپ وصل نکرده باشد. */
  private async sendViaWhatsapp(userId: string, text: string): Promise<boolean> {
    const jid = await this.whatsapp.getJidForUsername(userId);
    if (!jid) return false;
    await this.whatsapp.sendNotification(jid, text);
    return true;
  }

  /** ربات تلگرام، بله یا روبیکا. @returns false اگر آن ربات راه‌اندازی نشده یا کاربر به آن وصل نیست. */
  private async sendViaBot(platform: BotPlatform, userId: string, text: string): Promise<boolean> {
    if (!this.bots.hasPlatform(platform)) return false;
    const link = await this.botLinks.findByUserId(userId, platform);
    if (!link?.chatId) return false;
    await this.bots.sendNotification(link.chatId, text);
    return true;
  }
}
