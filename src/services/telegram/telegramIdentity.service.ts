import {
  Inject,
  Injectable,
  NotFoundException,
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
  ) {}

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
    const link =
      await this.repository.findByTelegramUserId(
        telegramUserId,
      );

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
    const link =
      await this.repository.findByTelegramUserId(
        telegramUserId,
      );

    return Boolean(
      link?.userId,
    );
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

    return this.repository.save(
      link,
    );
  }
}