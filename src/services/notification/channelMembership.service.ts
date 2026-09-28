import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { ChannelMembershipChangedEvent } from '../../domain/constants/channelEvents';
import { TELEGRAM_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { ITelegramLinkRepository } from '../../domain/repositories/telegram/ITelegramLinkRepository';
import { WhatsappService } from '../../application/services/agent/services/whatsapp.service';
import { TelegramService } from '../telegram/telegram.service';
import { CHANNEL_STATUS_SOCKET_EVENT, NotificationsGateway } from './notifications.gateway';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLATFORM_LABEL = { whatsapp: 'واتساپ', telegram: 'تلگرام' } as const;

// فقط نتیجه‌ی نهایی عضویت بیرون از پنل (تلگرام/واتساپ) خبر داده می‌شود؛
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
 *  - اگر کاربر آنلاین نیست: پیام در تلگرام یا واتساپ -- اول همان پلتفرمِ
 *    گروه/کانال، اگر آن ممکن نبود پلتفرم دیگر.
 */
@Injectable()
export class ChannelMembershipNotifier {
  private readonly logger = new Logger(ChannelMembershipNotifier.name);

  constructor(
    @Inject(TELEGRAM_LINK_REPOSITORY)
    private readonly telegramLinks: ITelegramLinkRepository,
    private readonly telegram: TelegramService,
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

  private async deliverOffline(userId: string, event: ChannelMembershipChangedEvent, text: string): Promise<void> {
    const order = event.platform === 'whatsapp' ? ['whatsapp', 'telegram'] as const : ['telegram', 'whatsapp'] as const;

    for (const platform of order) {
      try {
        if (platform === 'telegram') {
          const link = await this.telegramLinks.findByUserId(userId);
          if (!link?.chatId) continue;
          await this.telegram.sendNotification(link.chatId, text);
        } else {
          const jid = await this.whatsapp.getJidForUsername(userId);
          if (!jid) continue;
          await this.whatsapp.sendNotification(jid, text);
        }
        return;
      } catch (error) {
        this.logger.warn(
          `Channel status (${event.status}) via ${platform} to ${userId} failed: ${(error as Error).message}`,
        );
      }
    }

    this.logger.debug(`Channel status ${event.eventId}: no Telegram/WhatsApp route for offline user ${userId}`);
  }
}
