import { User } from '../../entities/auth/User';
import { BotLink } from '../../entities/agent/BotLink';
import type { BotPlatform } from '../../../services/messengerBot/core/botPlatform';

export interface IBotLinkRepository {
  findByTelegramUserId(
    telegramUserId: string,
  ): Promise<BotLink | null>;

  /** اتصال کاربر در یک پیام‌رسان (پیش‌فرض تلگرام). */
  findByUserId(
    userId: string,
    platform?: BotPlatform,
  ): Promise<BotLink | null>;

  /** همه‌ی اتصال‌های کاربر (تلگرام، بله، روبیکا). */
  findAllByUserId(userId: string): Promise<BotLink[]>;

  createUserWithLink(user: User, link: BotLink): Promise<BotLink>;

  assignInitialRole(telegramUserId: string, roleName: string): Promise<string>;

  save(
    entity: BotLink,
  ): Promise<BotLink>;
}