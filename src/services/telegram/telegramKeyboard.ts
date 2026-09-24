import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import TelegramBot from 'node-telegram-bot-api';

interface ChatKeyboard {
  messageId?: number;
  mainMenu?: TelegramBot.Message;
  mainMenuSignature?: string;
}

@Injectable()
export class TelegramKeyboardService {
  private readonly logger = new Logger(TelegramKeyboardService.name);
  // Only in-flight promises live locally; all menu state lives in Redis.
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly ttlSeconds: number;
  private readonly botId: string;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = Number(config.get('TELEGRAM_KEYBOARD_TTL_SECONDS', 2592000));
    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new Error('TELEGRAM_KEYBOARD_TTL_SECONDS must be a positive integer.');
    }
    this.botId = config.get<string>('TELEGRAM_BOT_TOKEN', '').split(':')[0];
  }

  /** Keep one main menu and delete superseded operation messages. */
  async sendMessage(
    bot: TelegramBot,
    chatId: string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
    isMainMenu = false,
  ): Promise<TelegramBot.Message> {

    

    //#region ----------- Normal Text Message -------------------------------
    if (!options?.reply_markup) return bot.sendMessage(chatId, text, options);
    //#endregion -------- Normal Text Dont Remove Keyboards-------------------



    if (!this.botId) throw new Error('TELEGRAM_BOT_TOKEN is required for keyboard state.');

    const key = RedisService.key('telegramKeyboard', this.botId, chatId);
    // Serialize transitions within this process. Multiple bot workers still need
    // distributed coordination for concurrent operations on the same chat.
    const operation = (this.pending.get(key) ?? Promise.resolve()).then(async () => {
      const current = (await this.redis.getJson<ChatKeyboard>(key)) ?? {};
      const previousId = current.messageId;
      const previousMainMenuId = current.mainMenu?.message_id;
      // Send first: a failed send must leave the existing menu available.
      const message = await bot.sendMessage(chatId, text, { ...options });
      if (isMainMenu) {
        current.mainMenu = message;
        delete current.mainMenuSignature;
      }
      current.messageId = message.message_id;

      await this.redis.setJson(key, current, this.ttlSeconds);

      const obsoleteIds = new Set<number>();
      if (previousId !== undefined) obsoleteIds.add(previousId);
      if (isMainMenu && previousMainMenuId !== undefined) {
        obsoleteIds.add(previousMainMenuId);
      }
      obsoleteIds.delete(message.message_id);
      for (const messageId of obsoleteIds) {
        try {
          if (!isMainMenu && messageId === previousMainMenuId) {
            await bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: chatId, message_id: messageId },
            );
          } else {
            await bot.deleteMessage(chatId, messageId);
          }
        } catch {
          this.logger.warn(`Could not remove previous operation in chat ${chatId}, message ${messageId}.`);
        }
      }
      return message;
    });
    const settled = operation.catch(() => undefined);
    this.pending.set(key, settled);
    try {
      return await operation;
    } finally {
      if (this.pending.get(key) === settled) this.pending.delete(key);
    }
  }

  sendMainMenu(
    bot: TelegramBot,
    chatId: string,
    text: string,
    options: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    return this.sendMessage(bot, chatId, text, options, true);
  }
}
