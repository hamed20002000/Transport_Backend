import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { botNamespace } from './botPlatform';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomInt } from 'node:crypto';
import TelegramBot from 'node-telegram-bot-api';
import { MultiBot } from './multiBot';
import { USER_REPOSITORY, BOT_LINK_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { IUserRepository } from '../../../domain/repositories/IUserRepopsitory';
import { IBotLinkRepository } from '../../../domain/repositories/messengerBot/IBotLinkRepository';
import { User } from '../../../domain/entities/auth/User';
import { BotLink } from '../../../domain/entities/agent/BotLink';
import { RecordStatus } from '../../../domain/enums/RecordStatus';
import { AccountType } from '../../../domain/enums/subscription';
import { BotCallback } from '../../../domain/constants/bot/BotCallback';
import { normalizePhoneNumber } from '../../../dto/auth/phone-number';
import { PasswordService } from '../../auth/password.service';
import { RedisService } from '../../redis/redis.service';
import { BotIdentityService } from './botIdentity.service';
import { BotSessionService } from './botSession.service';
import { BotMessagesService } from './botMessages.service';
import { BotMenuService } from './botMenu.service';

interface BotIdentityMetadata {
  externalUserId: string;
  chatId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

const ACCESS_LOCK_TTL_SECONDS = 120;
const PASSWORD_LENGTH = 10;
const PASSWORD_CHARACTERS = 'abcdefghjkmnpqrstuvwxyz23456789';

@Injectable()
export class BotAccessService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(BOT_LINK_REPOSITORY) private readonly links: IBotLinkRepository,
    private readonly passwords: PasswordService,
    private readonly identity: BotIdentityService,
    private readonly sessions: BotSessionService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly messages: BotMessagesService,
    private readonly menu: BotMenuService,
    private readonly bot: MultiBot,
  ) {}

  /** Returns true when account setup handles the update; false continues normal routing. */
  async handle(
    message: TelegramBot.Message,
    from: TelegramBot.User,
    callback?: string,
  ): Promise<boolean> {
    // Contact requests and Web credentials belong only in the user's private chat.
    //بررسی اینکه پیغام از چت خصوصی آمده یا نه و اینکه چون چت هاخصوصی هیتند با شناسه کاربر با شناسه جت یکی باشند در غیر اینصورت ادامه نمیدهیم
    if (message.chat.type !== 'private' || message.chat.id !== from.id) return true;// 
    
    //#region ----------------------------  ذخیره شناسه کاربر و شناسه چت که باید با هم برابر باشند ---------------
    const externalUserId = String(from.id);
    const chatId = String(message.chat.id);
    //#endregion -------------------------------------------------------------------------------------------------
    
    //#region ------------------------------ بررسی اینکه کاربر قبلا در سیستم ثبت نام کرده یا نه --------------------
    if (await this.identity.getUserId(externalUserId)) {
      return this.handleIdentifiedUser(chatId, externalUserId, callback);
    }
    //#endregion -------------------------------------------------------------------------------------------------
    
    const namespace = botNamespace(this.config);
    const lock = RedisService.key('telegramAccessLock', namespace, externalUserId);
    const owner = randomBytes(16).toString('hex');
    if (!(await this.redis.setIfAbsent(lock, owner, ACCESS_LOCK_TTL_SECONDS))) return true;
    try {
      // A concurrent contact/callback may have completed before we acquired the lock.
      if (await this.redis.get(RedisService.key('telegramIdentity', namespace, externalUserId))) {
        return await this.handleIdentifiedUser(chatId, externalUserId, callback);
      }
      await this.handleUnidentifiedUser(message, from, callback);
      return true;
    } catch (error) {
      if (
        error instanceof ConflictException ||
        (error as { driverError?: { code?: string } })?.driverError?.code === '23505'
      ) {
        await this.bot.sendMessage(chatId, this.messages.get('identity.conflict'));
        return true;
      }
      throw error;
    } finally {
      await this.redis.deleteIfValue(lock, owner);
    }
  }

  private async handleIdentifiedUser(
    chatId: string,
    externalUserId: string,
    callback?: string,
  ): Promise<boolean> {
    const roles = await this.identity.getMenuRoles(externalUserId);
    if (roles?.length) {
      if (!callback?.startsWith(BotCallback.RegisterAccountTypePrefix)) return false;
      // دکمه‌ی «انتخاب نوع حساب» قدیمی؛ نقش از قبل هست، همان منوی نقش.
      await this.menu.showMenuForRoles(chatId, externalUserId, roles);
      return true;
    }
    const accountType = Object.values(AccountType).find(
      type => callback === `${BotCallback.RegisterAccountTypePrefix}${type}`,
    );
    if (!accountType) {
      await this.showAccountTypes(chatId);
      return true;
    }
    const userId = await this.links.assignInitialRole(externalUserId, accountType);
    await this.identity.cacheUserId(externalUserId, userId);
    await this.completeAccountSetup(chatId, externalUserId);
    return true;
  }

  private async handleUnidentifiedUser(
    message: TelegramBot.Message,
    from: TelegramBot.User,
    callback?: string,
  ): Promise<void> {
    const externalUserId = String(from.id);
    const chatId = String(message.chat.id);
    const metadata: BotIdentityMetadata = {
      externalUserId,
      chatId,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    };
    if (!callback && message.contact) {
      await this.handleContact(message.contact, metadata);
      return;
    }
    await this.requestContact(chatId);
  }

  private async handleContact(
    contact: TelegramBot.Contact,
    metadata: BotIdentityMetadata,
  ): Promise<void> {
    const { chatId, externalUserId } = metadata;
    // مقایسه‌ی رشته‌ای: شناسه‌های بله/روبیکا پیشوند دارند (bale:123) و عدد نیستند.
    if (contact.user_id === undefined || contact.user_id === null || String(contact.user_id) !== metadata.externalUserId) {
      await this.bot.sendMessage(chatId, this.messages.get('account.invalidContactOwner'));
      return;
    }
    const phone = normalizePhoneNumber(contact.phone_number);
    if (typeof phone !== 'string' || !/^09[0-9]{9}$/.test(phone)) {
      await this.bot.sendMessage(chatId, this.messages.get('identity.invalidPhone'));
      return;
    }
    const user = await this.users.findByMobile(phone);
    if (user) {
      await this.linkExistingUser(metadata, user);
      return;
    }
    await this.registerNewUser(metadata, phone);
    await this.showAccountTypes(chatId);
  }

  private async linkExistingUser(metadata: BotIdentityMetadata, user: User): Promise<void> {
    if (user.recordStatus !== RecordStatus.Active) {
      await this.bot.sendMessage(metadata.chatId, this.messages.get('identity.inactive'));
      return;
    }
    await this.identity.linkUser({ ...metadata, userId: user.id });
    const roles = await this.identity.getMenuRoles(metadata.externalUserId);
    if (!roles?.length) {
      await this.showAccountTypes(metadata.chatId);
      return;
    }
    await this.completeAccountSetup(metadata.chatId, metadata.externalUserId);
  }

  private async registerNewUser(
    metadata: BotIdentityMetadata,
    phoneNumber: string,
  ): Promise<void> {
    const { chatId, externalUserId } = metadata;
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
    const oldLink = await this.links.findByExternalUserId(externalUserId);
    if (oldLink?.userId) throw new ConflictException('Messenger account is already linked.');
    const link = Object.assign(oldLink ?? new BotLink(), {
      externalUserId,
      chatId,
      externalUsername: metadata.username,
      firstName: metadata.firstName,
      lastName: metadata.lastName,
      lastInteractionAt: new Date(),
    });
    const saved = await this.links.createUserWithLink(user, link);
    await this.sendWebCredentials(chatId, user.username, password);
    await this.identity.cacheUserId(externalUserId, saved.userId!);
  }

  private async sendWebCredentials(
    chatId: string,
    username: string,
    password: string,
  ): Promise<void> {
    // Send directly: never persist plaintext credentials in keyboard/session state.
    try {
      await this.bot.sendMessage(
        chatId,
        this.messages.get('identity.credentials', 'fa', {
          username: username,
          password,
        }),
        { protect_content: true, reply_markup: { remove_keyboard: true } },
      );
    } catch {
      // A Telegram transport error may contain the message text, including the password.
      throw new Error('Could not deliver Web credentials through the messenger bot.');
    }
  }

  private async completeAccountSetup(chatId: string, externalUserId: string): Promise<void> {
    await this.sessions.delete(externalUserId);
    await this.bot.sendMessage(chatId, this.messages.get('identity.connected'), { reply_markup: { remove_keyboard: true } });
    await this.menu.showMenuForUser(chatId, externalUserId);
  }

  private async requestContact(chatId: string): Promise<void> {
    await this.bot.sendMessage(chatId, this.messages.get('identity.requestPhone'), {
      reply_markup: {
        keyboard: [[{ text: this.messages.get('identity.sharePhone'), request_contact: true, style: 'success' }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }

  private async showAccountTypes(chatId: string): Promise<void> {
    await this.bot.sendMessage(chatId, this.messages.get('identity.selectAccountType'), {
      reply_markup: {
        inline_keyboard: Object.values(AccountType).map((type) => [
          {
            text: this.messages.get(`account.${type.toLowerCase()}`),
            callback_data: `${BotCallback.RegisterAccountTypePrefix}${type}`,
          },
        ]),
      },
    });
  }
}
