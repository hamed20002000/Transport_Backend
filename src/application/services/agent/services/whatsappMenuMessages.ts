import { Injectable } from '@nestjs/common';
import type { proto } from '@whiskeysockets/baileys' with { 'resolution-mode': 'import' };
import { RedisService } from 'src/services/redis/redis.service';

// پیام منویی که واتساپ دیگر اجازه‌ی حذفش را نمی‌دهد (قدیمی) بعد از این مدت فراموش می‌شود
const TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * پیام‌های منو/گزینه‌داری که ربات برای هر کاربر واتساپ فرستاده (منوی گفتگوها، لیست انتخاب
 * دستیار، سؤال تأیید ویس) تا با «/start» همه پاک شوند و فقط منوی تازه بماند. اعلان‌ها
 * (بار جدید، درخواست راننده) اینجا ثبت نمی‌شوند و می‌مانند.
 */
@Injectable()
export class WhatsappMenuMessages {
  constructor(private readonly redis: RedisService) {}

  async track(userId: string, messageKey: proto.IMessageKey): Promise<void> {
    const key = this.key(userId);
    const keys = (await this.redis.getJson<proto.IMessageKey[]>(key)) ?? [];
    await this.redis.setJson(key, [...keys, messageKey], TTL_SECONDS);
  }

  /** همه را با remove حذف می‌کند؛ آن‌هایی که حذف نشدند (مثلاً قطعی اتصال) برای /start بعدی می‌مانند. */
  async clear(userId: string, remove: (messageKey: proto.IMessageKey) => Promise<void>): Promise<void> {
    const key = this.key(userId);
    const failed: proto.IMessageKey[] = [];
    for (const messageKey of (await this.redis.getJson<proto.IMessageKey[]>(key)) ?? []) {
      try {
        await remove(messageKey);
      } catch {
        failed.push(messageKey);
      }
    }
    if (failed.length) await this.redis.setJson(key, failed, TTL_SECONDS);
    else await this.redis.delete(key);
  }

  private key(userId: string): string {
    return RedisService.key('whatsappMenuMessages', userId);
  }
}
