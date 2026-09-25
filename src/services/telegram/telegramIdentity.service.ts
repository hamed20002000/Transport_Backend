import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import {
  Inject,
  Injectable,
  ConflictException,
} from '@nestjs/common';

import { TelegramLink } from '../../domain/entities/agent/TelegramLink';

import { ITelegramLinkRepository } from '../../domain/repositories/telegram/ITelegramLinkRepository';

import {
  TELEGRAM_LINK_REPOSITORY,
} from '../../domain/repositories/repository.tokens';

@Injectable()
export class TelegramIdentityService {
  constructor(
    @Inject(TELEGRAM_LINK_REPOSITORY)
    private readonly repository: ITelegramLinkRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async cacheUserId(telegramUserId: string, userId: string): Promise<void> {
    const botId = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN').split(':')[0];
    await this.redis.delete(RedisService.key('telegramIdentityRoles', botId, telegramUserId));
    await this.redis.set(RedisService.key('telegramIdentity', botId, telegramUserId), userId, 86400);
  }

  /** Menu presentation only; business authorization must still check current permissions. */
  async getMenuRoles(telegramUserId: string): Promise<string[] | null> {
    const botId = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN').split(':')[0];
    const key = RedisService.key('telegramIdentityRoles', botId, telegramUserId);
    const roles = await this.redis.getJson<string[]>(key);
    if (roles !== null) return roles;
    const link = await this.repository.findByTelegramUserId(telegramUserId);
    if (!link?.userId || !link.user) return null;
    const names = link.user.userRoles?.filter(item => item.role != null).map(item => item.role.name) ?? [];
    await this.redis.setJson(key, names, 86400);
    return names;
  }

  /*
   * =====================================================
   * Find Telegram Link
   * =====================================================
   */

  async findByTelegramUserId(
    telegramUserId: string,
  ): Promise<TelegramLink | null> {
    return this.repository.findByTelegramUserId(
      telegramUserId,
    );
  }

  /*
   * =====================================================
   * Find Telegram Link By System User
   * =====================================================
   */

  async findByUserId(
    userId: string,
  ): Promise<TelegramLink | null> {
    return this.repository.findByUserId(
      userId,
    );
  }

  /*
   * =====================================================
   * Get System User Id
   * =====================================================
   */

  async getUserId(
    telegramUserId: string,
  ): Promise<string | null> {
    const botId = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN').split(':')[0];
    try {
      const cached = await this.redis.get(RedisService.key('telegramIdentity', botId, telegramUserId));
      if (cached) return cached;
    } catch {
      // Redis unavailable: fall back to the database.
    }
    const link = await this.repository.findByTelegramUserId(telegramUserId);
    if (link?.userId) {
      try {
        await this.cacheUserId(telegramUserId, link.userId);
        if (link.user) {
          const roles = link.user.userRoles?.filter(item => item.role != null).map(item => item.role.name) ?? [];
          await this.redis.setJson(RedisService.key('telegramIdentityRoles', botId, telegramUserId), roles, 86400);
        }
      } catch {
        // Caching is best-effort; the database result is still valid.
      }
    }
    return link?.userId ?? null;
  }

  /*
   * =====================================================
   * Is Registered
   * =====================================================
   */

  async isRegistered(
    telegramUserId: string,
  ): Promise<boolean> {
    return Boolean(await this.getUserId(telegramUserId));
  }

  /*
   * =====================================================
   * Touch Existing Link
   * =====================================================
   *
   * IMPORTANT:
   *
   * This method MUST NOT create TelegramLink.
   *
   * A random Telegram user may send a message to the bot
   * and never use the application again.
   *
   * TelegramLink represents a real connection between
   * Telegram identity and a User in our system.
   *
   * Therefore:
   *
   * - Existing TelegramLink -> update metadata
   * - Unknown Telegram user -> do nothing
   *
   * TelegramLink is created only by linkUser().
   */

  async touch(params: {
    telegramUserId: string;
    chatId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<TelegramLink | null> {
    const link =
      await this.repository.findByTelegramUserId(
        params.telegramUserId,
      );

    /*
     * Do NOT create a database record
     * for anonymous Telegram users.
     */
    if (!link) {
      return null;
    }

    link.chatId =
      params.chatId;

    link.telegramUsername =
      params.username;

    link.firstName =
      params.firstName;

    link.lastName =
      params.lastName;

    link.lastInteractionAt =
      new Date();

    return this.repository.save(
      link,
    );
  }

  /*
   * =====================================================
   * Link Telegram Account To System User
   * =====================================================
   *
   * This is the ONLY place in this service where
   * TelegramLink can be created.
   *
   * One system User can use:
   *
   * User
   *  ├── Telegram
   *  ├── WhatsApp
   *  └── Web/PWA
   *
   * TelegramLink only maps Telegram identity
   * to the existing User.
   */

  async linkUser(params: {
    telegramUserId: string;
    chatId: string;
    userId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<TelegramLink> {
    let link =
      await this.repository.findByTelegramUserId(
        params.telegramUserId,
      );

    if (link?.userId && link.userId !== params.userId) {
      throw new ConflictException('Telegram account is already linked.');
    }
    const existing = await this.repository.findByUserId(params.userId);
    if (existing && existing.telegramUserId !== params.telegramUserId) {
      throw new ConflictException('User is already linked to another Telegram account.');
    }

    /*
     * TelegramLink does not exist yet.
     *
     * Now creation is allowed because
     * we have a real system User.
     */
    if (!link) {
      link =
        new TelegramLink();

      link.telegramUserId =
        params.telegramUserId;
    }

    link.userId =
      params.userId;

    link.chatId =
      params.chatId;

    link.telegramUsername =
      params.username;

    link.firstName =
      params.firstName;

    link.lastName =
      params.lastName;

    link.lastInteractionAt =
      new Date();

    const saved = await this.repository.save(link);
    await this.cacheUserId(params.telegramUserId, params.userId);
    return saved;
  }
}
