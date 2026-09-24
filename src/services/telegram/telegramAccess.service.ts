import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt } from 'node:crypto';
import TelegramBot from 'node-telegram-bot-api';
import { USER_REPOSITORY, TELEGRAM_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { IUserRepository } from '../../domain/repositories/IUserRepopsitory';
import { ITelegramLinkRepository } from '../../domain/repositories/telegram/ITelegramLinkRepository';
import { User } from '../../domain/entities/auth/User';
import { TelegramLink } from '../../domain/entities/agent/TelegramLink';
import { RecordStatus } from '../../domain/enums/RecordStatus';
import { AccountType } from '../../domain/enums/subscription';
import { TelegramCallback } from '../../domain/constants/telegram/TelegramCallback';
import { normalizePhoneNumber } from '../../dto/auth/phone-number';
import { PasswordService } from '../auth/password.service';
import { RedisService } from '../redis/redis.service';
import { TelegramIdentityService } from './telegramIdentity.service';
import { TelegramSessionService } from './telegramSession.service';
import { TelegramMessagesService } from './telegramMessages.service';
import { TelegramMenuService } from './telegramMenu.service';

interface TelegramIdentityMetadata {
  telegramUserId: string;
  chatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

const ACCESS_LOCK_TTL_SECONDS = 120;
const PASSWORD_LENGTH = 10;
const PASSWORD_CHARACTERS = 'abcdefghjkmnpqrstuvwxyz23456789';

@Injectable()
export class TelegramAccessService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(TELEGRAM_LINK_REPOSITORY) private readonly links: ITelegramLinkRepository,
    private readonly passwords: PasswordService,
    private readonly identity: TelegramIdentityService,
    private readonly sessions: TelegramSessionService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly messages: TelegramMessagesService,
    private readonly menu: TelegramMenuService,
  ) {}

  /** Returns true when account setup handles the update; false continues normal routing. */
  async handle(
    bot: TelegramBot,
    message: TelegramBot.Message,
    from: TelegramBot.User,
    callback?: string,
  ): Promise<boolean> {
    // Contact requests and Web credentials belong only in the user's private chat.
    if (message.chat.type !== 'private' || message.chat.id !== from.id) return true;
    const telegramUserId = String(from.id);
    const chatId = String(message.chat.id);
    if (await this.identity.getUserId(telegramUserId)) {
      return this.handleIdentifiedUser(bot, chatId, telegramUserId, callback);
    }
    const botId = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN').split(':')[0];
    const lock = RedisService.key('telegramAccessLock', botId, telegramUserId);
    const owner = randomBytes(16).toString('hex');
    if (!(await this.redis.setIfAbsent(lock, owner, ACCESS_LOCK_TTL_SECONDS))) return true;
    try {
      // A concurrent contact/callback may have completed before we acquired the lock.
      if (await this.redis.get(RedisService.key('telegramIdentity', botId, telegramUserId))) {
        return await this.handleIdentifiedUser(bot, chatId, telegramUserId, callback);
      }
      await this.handleUnidentifiedUser(bot, message, from, callback);
      return true;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        (error as { driverError?: { code?: string } })?.driverError?.code === '23505'
      ) {
        await bot.sendMessage(chatId, this.messages.get('identity.conflict'));
        return true;
      }
      throw error;
    } finally {
      await this.redis.deleteIfValue(lock, owner);
    }
  }

  private async handleIdentifiedUser(
    bot: TelegramBot,
    chatId: string,
    telegramUserId: string,
    callback?: string,
  ): Promise<boolean> {
    const roles = await this.identity.getMenuRoles(telegramUserId);
    if (roles?.length) {
      if (!callback?.startsWith(TelegramCallback.RegisterAccountTypePrefix)) return false;
      await this.menu.showMenuForUser(bot, chatId, telegramUserId);
      return true;
    }
    const accountType = Object.values(AccountType).find(
      type => callback === `${TelegramCallback.RegisterAccountTypePrefix}${type}`,
    );
    if (!accountType) {
      await this.showAccountTypes(bot, chatId);
      return true;
    }
    const userId = await this.links.assignInitialRole(telegramUserId, accountType);
    await this.identity.cacheUserId(telegramUserId, userId);
    await this.completeAccountSetup(bot, chatId, telegramUserId);
    return true;
  }

  private async handleUnidentifiedUser(
    bot: TelegramBot,
    message: TelegramBot.Message,
    from: TelegramBot.User,
    callback?: string,
  ): Promise<void> {
    const telegramUserId = String(from.id);
    const chatId = String(message.chat.id);
    const metadata: TelegramIdentityMetadata = {
      telegramUserId,
      chatId,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    };
    if (!callback && message.contact) {
      await this.handleContact(bot, message.contact, metadata);
      return;
    }
    await this.requestContact(bot, chatId);
  }

  private async handleContact(
    bot: TelegramBot,
    contact: TelegramBot.Contact,
    metadata: TelegramIdentityMetadata,
  ): Promise<void> {
    const { chatId, telegramUserId } = metadata;
    if (contact.user_id !== Number(metadata.telegramUserId)) {
      await bot.sendMessage(chatId, this.messages.get('account.invalidContactOwner'));
      return;
    }
    const phone = normalizePhoneNumber(contact.phone_number);
    if (typeof phone !== 'string' || !/^09[0-9]{9}$/.test(phone)) {
      await bot.sendMessage(chatId, this.messages.get('identity.invalidPhone'));
      return;
    }
    const user = await this.users.findByMobile(phone);
    if (user) {
      await this.linkExistingUser(bot, metadata, user);
      return;
    }
    await this.registerNewUser(bot, metadata, phone);
    await this.showAccountTypes(bot, chatId);
  }

  private async linkExistingUser(bot: TelegramBot, metadata: TelegramIdentityMetadata, user: User): Promise<void> {
    if (user.recordStatus !== RecordStatus.Active) {
      await bot.sendMessage(metadata.chatId, this.messages.get('identity.inactive'));
      return;
    }
    await this.identity.linkUser({ ...metadata, userId: user.id });
    const roles = await this.identity.getMenuRoles(metadata.telegramUserId);
    if (!roles?.length) {
      await this.showAccountTypes(bot, metadata.chatId);
      return;
    }
    await this.completeAccountSetup(bot, metadata.chatId, metadata.telegramUserId);
  }

  private async registerNewUser(
    bot: TelegramBot,
    metadata: TelegramIdentityMetadata,
    phoneNumber: string,
  ): Promise<void> {
    const { chatId, telegramUserId } = metadata;
    const password = Array.from(
      { length: PASSWORD_LENGTH },
      () => PASSWORD_CHARACTERS[randomInt(PASSWORD_CHARACTERS.length)],
    ).join('');
    const user = Object.assign(new User(), {
      username: phoneNumber,
      passwordHash: await this.passwords.hashPassword(password),
      mobile: phoneNumber,
      recordStatus: RecordStatus.Active,
      mustChangePassword: false,
    });
    const oldLink = await this.links.findByTelegramUserId(telegramUserId);
    if (oldLink?.userId) throw new ConflictException('Telegram account is already linked.');
    const link = Object.assign(oldLink ?? new TelegramLink(), {
      telegramUserId,
      chatId,
      telegramUsername: metadata.username,
      firstName: metadata.firstName,
      lastName: metadata.lastName,
      lastInteractionAt: new Date(),
    });
    const saved = await this.links.createUserWithLink(user, link);
    await this.sendWebCredentials(bot, chatId, user.username, password);
    await this.identity.cacheUserId(telegramUserId, saved.userId!);
  }

  private async sendWebCredentials(
    bot: TelegramBot,
    chatId: string,
    username: string,
    password: string,
  ): Promise<void> {
    // Send directly: never persist plaintext credentials in keyboard/session state.
    try {
      await bot.sendMessage(
        chatId,
        this.messages.get('identity.credentials', 'fa', {
          username: username,
          password,
        }),
        { protect_content: true, reply_markup: { remove_keyboard: true } },
      );
    } catch {
      // A Telegram transport error may contain the message text, including the password.
      throw new Error('Could not deliver Telegram Web credentials.');
    }
  }

  private async completeAccountSetup(bot: TelegramBot, chatId: string, telegramUserId: string): Promise<void> {
    await this.sessions.delete(telegramUserId);
    await bot.sendMessage(chatId, this.messages.get('identity.connected'), { reply_markup: { remove_keyboard: true } });
    await this.menu.showMenuForUser(bot, chatId, telegramUserId);
  }

  private async requestContact(bot: TelegramBot, chatId: string): Promise<void> {
    await bot.sendMessage(chatId, this.messages.get('identity.requestPhone'), {
      reply_markup: {
        keyboard: [[{ text: this.messages.get('identity.sharePhone'), request_contact: true, style: 'success' }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }

  private async showAccountTypes(bot: TelegramBot, chatId: string): Promise<void> {
    await bot.sendMessage(chatId, this.messages.get('identity.selectAccountType'), {
      reply_markup: {
        inline_keyboard: Object.values(AccountType).map((type) => [
          {
            text: this.messages.get(`account.${type.toLowerCase()}`),
            callback_data: `${TelegramCallback.RegisterAccountTypePrefix}${type}`,
          },
        ]),
      },
    });
  }
}
