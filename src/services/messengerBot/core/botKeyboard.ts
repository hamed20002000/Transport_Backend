import { Injectable, Logger } from '@nestjs/common';
import { botNamespace } from './botPlatform';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import TelegramBot from 'node-telegram-bot-api';
import { MultiBot } from './multiBot';
import { MenuButton } from './menuTextMatch';

interface ChatKeyboard {
  messageId?: number;
  /** دکمه‌های آخرین منو تا کاربر بتواند با تایپ/ویس هم انتخاب کند. */
  buttons?: MenuButton[];
  mainMenu?: TelegramBot.Message;
  mainMenuSignature?: string;
}

@Injectable()
export class BotKeyboardService {
  private readonly logger = new Logger(BotKeyboardService.name);
  // Only in-flight promises live locally; all menu state lives in Redis.
  private readonly pending = new Map<string, Promise<unknown>>();
  // Message whose button the user just pressed; the next menu replaces it in place.
  private readonly editTargets = new Map<string, number>();
  private readonly ttlSeconds: number;
  private readonly namespace: string;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
    private readonly bot: MultiBot,
  ) {
    this.ttlSeconds = Number(config.get('TELEGRAM_KEYBOARD_TTL_SECONDS', 2592000));
    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new Error('TELEGRAM_KEYBOARD_TTL_SECONDS must be a positive integer.');
    }
    this.namespace = botNamespace(config);
  }

  /** The user pressed a button on this message: the next inline menu edits it instead of sending a new one. */
  //#region ----------- ایدی پیام فعلی رو برای ویرایش در صورتی که پیام بعدی هم کیبورد باشد را نکه میدارد -------------------------------         
  useCallbackMessage(chatId: string, messageId: number): void {
    this.editTargets.set(chatId, messageId);
  }
  //#endregion --------------------------------------------------------------------------------

  /** New user input arrived: following menus must appear below it, not above. */
  
  //#region --------------- ایدی پیام فعلی رو حذف میکنه تا پیام ها به روال عادی ارسال شوند --------
  clearCallbackMessage(chatId: string): void {
    this.editTargets.delete(chatId);
  }
  //#endregion --------------------------------------------------------------------------------

  
  //#region --------------- دکمه های منو فعلی که جلوی کاربر است را برمیگرداند -------------------------------
  async getMenuButtons(chatId: string): Promise<{ messageId: number; buttons: MenuButton[] } | null> {
    const current = await this.redis.getJson<ChatKeyboard>(RedisService.key('telegramKeyboard', this.namespace, chatId));
    return current?.messageId !== undefined && current.buttons?.length
      ? { messageId: current.messageId, buttons: current.buttons }
      : null;
  }
  //#endregion --------------------------------------------------------------------------------

  /** Keep one main menu and delete superseded operation messages. */
  async sendMessage(
    chatId: string,
    text: string,
    options?: TelegramBot.SendMessageOptions,
    isMainMenu = false,
  ): Promise<TelegramBot.Message> {

    

    //#region ----------- Not a menu: no inline buttons -----------------------
    // Plain text, or only remove_keyboard / a bottom keyboard. Tracking it as the menu
    // would delete it as soon as the next menu arrives, before the user reads it.
    if (!hasInlineKeyboard(options?.reply_markup)) {
      // It now sits below the menu, so editing the menu would hide the reply under it.
      this.editTargets.delete(chatId);
      return this.bot.sendMessage(chatId, text, options);
    }
    //#endregion -----------------------------------------------------------




    const key = RedisService.key('telegramKeyboard', this.namespace, chatId);
    // Serialize transitions within this process. Multiple bot workers still need
    // distributed coordination for concurrent operations on the same chat.
    const operation = (this.pending.get(key) ?? Promise.resolve()).then(async () => {
      const current = (await this.redis.getJson<ChatKeyboard>(key)) ?? {};
      const previousId = current.messageId;
      const previousMainMenuId = current.mainMenu?.message_id;
      const target = this.editTargets.get(chatId);
      this.editTargets.delete(chatId);
      // Only edit the bot's latest menu; buttons on older messages (e.g. notifications) keep their message.
      const editable = target !== undefined
        && (String(target) === String(previousId) || String(target) === String(previousMainMenuId));
      // Send first: a failed send must leave the existing menu available.
      const message = (editable && await this.editInPlace(chatId, target, text, options))
        || await this.bot.sendMessage(chatId, text, { ...options });
      if (isMainMenu) {
        current.mainMenu = message;
        delete current.mainMenuSignature;
      } else if (String(message.message_id) === String(previousMainMenuId)) {
        // The main menu message was turned into this operation; it is no longer the main menu.
        delete current.mainMenu;
        delete current.mainMenuSignature;
      }
      current.messageId = message.message_id;
      current.buttons = inlineButtons(options.reply_markup);

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
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: chatId, message_id: messageId },
            );
          } else {
            await this.bot.deleteMessage(chatId, messageId);
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

  private async editInPlace(
    chatId: string,
    messageId: number,
    text: string,
    options: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message | null> {
    try {
      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: options.parse_mode,
        disable_web_page_preview: options.disable_web_page_preview,
        reply_markup: options.reply_markup as TelegramBot.InlineKeyboardMarkup,
      });
    } catch (error) {
      // Pressing the same button twice yields identical content; the message is already correct.
      if (!/not modified/i.test((error as Error)?.message ?? '')) {
        this.logger.warn(`Could not edit menu in chat ${chatId}, message ${messageId}; sending a new one.`);
        return null;
      }
    }
    return { message_id: messageId, date: Math.floor(Date.now() / 1000), chat: { id: chatId }, text } as unknown as TelegramBot.Message;
  }

  sendMainMenu(
    chatId: string,
    text: string,
    options: TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message> {
    return this.sendMessage(chatId, text, options, true);
  }
}

type ReplyMarkup = TelegramBot.SendMessageOptions['reply_markup'];

function hasInlineKeyboard(markup: ReplyMarkup): markup is TelegramBot.InlineKeyboardMarkup {
  return !!markup && typeof markup === 'object' && 'inline_keyboard' in markup;
}

function inlineButtons(markup: ReplyMarkup): MenuButton[] {
  if (!hasInlineKeyboard(markup)) return [];
  return markup.inline_keyboard
    .flat()
    .filter((button) => button.callback_data)
    .map((button) => ({ text: button.text, data: button.callback_data! }));
}
