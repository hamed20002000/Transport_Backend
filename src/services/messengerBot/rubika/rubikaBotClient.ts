import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { extname, join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import TelegramBot from 'node-telegram-bot-api';

/** id دکمه‌ی «اشتراک شماره» -- فقط contact رسیده از همین دکمه شماره‌ی خود کاربر حساب می‌شود. */
const SHARE_PHONE_BUTTON_ID = 'share_phone';
const PHONE_TEXT = /^\+?\d{10,15}$/;

// پیام‌هایی که بعد از قطعی/ری‌استارت دیر می‌رسند و از این قدیمی‌ترند پردازش نمی‌شوند.
const MAX_UPDATE_AGE_SECONDS = 120;
const POLL_INTERVAL_MS = 1000;
const POLL_ERROR_DELAY_MS = 5000;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const AUDIO_EXTENSIONS = new Set(['.ogg', '.oga', '.opus', '.mp3', '.m4a', '.wav', '.aac', '.amr']);

interface RubikaButton {
  id: string;
  type: 'Simple' | 'AskMyPhoneNumber';
  button_text: string;
}

interface RubikaKeypad {
  rows: { buttons: RubikaButton[] }[];
  resize_keyboard?: boolean;
  on_time_keyboard?: boolean;
}

interface RubikaMessage {
  message_id: string;
  text?: string;
  time: string | number;
  sender_type?: 'User' | 'Bot';
  sender_id?: string;
  aux_data?: { button_id?: string; start_id?: string };
  file?: { file_id: string; file_name?: string; size?: string };
  forwarded_from?: unknown;
  contact_message?: { phone_number: string; first_name?: string; last_name?: string };
}

interface RubikaUpdate {
  type: string;
  chat_id: string;
  new_message?: RubikaMessage;
}

/** محل ذخیره‌ی offset تا بعد از ری‌استارت آپدیت‌های قبلی دوباره پردازش نشوند. */
export interface RubikaOffsetStore {
  load(): Promise<string | null>;
  save(offsetId: string): Promise<void>;
}

interface RubikaInlineMessage {
  sender_id?: string;
  text?: string;
  aux_data?: { button_id?: string };
  message_id: string;
  chat_id: string;
}

type ReplyMarkup = {
  inline_keyboard?: TelegramBot.InlineKeyboardButton[][];
  keyboard?: TelegramBot.KeyboardButton[][];
  remove_keyboard?: boolean;
};

/** خطا با همان شکل خطای node-telegram-bot-api تا isPermanentTelegramError برایش هم کار کند. */
export class RubikaBotApiError extends Error {
  readonly response: { statusCode: number; body: { error_code: number; description: string } };

  constructor(method: string, status: string) {
    super(`Rubika ${method} failed: ${status}`);
    const code = status === 'INVALID_INPUT' ? 400 : status === 'INVALID_ACCESS' ? 403 : status === 'TOO_REQUESTS' ? 429 : 500;
    this.response = { statusCode: code, body: { error_code: code, description: status } };
  }
}

/**
 * ربات رسمی روبیکا (botapi.rubika.ir/v3) با همان متدهایی از TelegramBot که
 * ربات اصلی استفاده می‌کند؛ آپدیت‌ها هم به شکل Message/CallbackQuery تلگرام
 * تبدیل می‌شوند. پس منو، خرید اشتراک و agent بدون تغییر روی روبیکا کار می‌کنند.
 *
 * دکمه‌های شیشه‌ای (inline keypad) را روبیکا فقط با webhook خبر می‌دهد:
 *   - با RUBIKA_WEBHOOK_URL: دکمه‌ها زیر خود پیام‌اند (مثل تلگرام)
 *   - بدون آن (polling): دکمه‌ها به کیبورد پایین چت (chat keypad) تبدیل می‌شوند
 *     و زدنشان مثل callback_query همان پیام رفتار می‌کند.
 */
export class RubikaBotClient extends EventEmitter {
  private readonly logger = new Logger(RubikaBotClient.name);
  private readonly http: AxiosInstance;
  private polling = false;
  private offsetId?: string;
  // حالت polling: آخرین پیامی که دکمه‌هایش روی کیبورد پایین چت است.
  private readonly keypadMessage = new Map<string, string>();

  constructor(
    token: string,
    private readonly webhookUrl?: string,
    baseUrl = 'https://botapi.rubika.ir/v3',
    private readonly offsetStore?: RubikaOffsetStore,
  ) {
    super();
    this.http = axios.create({ baseURL: `${baseUrl}/${token}/`, timeout: 15_000 });
  }

  private get inlineMode(): boolean {
    return !!this.webhookUrl;
  }

  // ------------------------------------------------------------------
  // راه‌اندازی
  // ------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.webhookUrl) {
      for (const type of ['ReceiveUpdate', 'ReceiveInlineMessage']) {
        await this.call('updateBotEndpoints', { url: this.webhookUrl, type });
      }
      return;
    }
    this.offsetId = (await this.offsetStore?.load().catch((error: Error) => {
      this.logger.warn(`Could not load Rubika poll offset: ${error.message}`);
      return null;
    })) ?? undefined;
    this.polling = true;
    void this.pollLoop();
  }

  isPolling(): boolean {
    return this.polling;
  }

  async stopPolling(): Promise<void> {
    this.polling = false;
  }

  private async pollLoop(): Promise<void> {
    // بدون offset ذخیره‌شده، اولین دسته فقط صف قدیمی روبیکاست: «شروع ربات»های قدیمی دوباره /start حساب نشوند.
    let backlog = !this.offsetId;
    while (this.polling) {
      try {
        const data = await this.call<{ updates?: RubikaUpdate[]; next_offset_id?: string }>('getUpdates', {
          ...(this.offsetId ? { offset_id: this.offsetId } : {}),
          limit: 100,
        });
        // offset قبل از پردازش ذخیره می‌شود: با ری‌استارت وسط کار، پیام‌ها دوباره پردازش نمی‌شوند.
        if (data.next_offset_id && data.next_offset_id !== this.offsetId) {
          this.offsetId = data.next_offset_id;
          await this.offsetStore?.save(data.next_offset_id).catch((error: Error) =>
            this.logger.warn(`Could not save Rubika poll offset: ${error.message}`),
          );
        }
        for (const update of data.updates ?? []) {
          if (backlog && update.type === 'StartedBot') continue;
          this.handleUpdate(update);
        }
        backlog = false;
        await sleep(POLL_INTERVAL_MS);
      } catch (error) {
        this.emit('polling_error', error);
        await sleep(POLL_ERROR_DELAY_MS);
      }
    }
  }

  /** بدنه‌ی درخواست webhook روبیکا: { update } یا { inline_message }. */
  handleWebhook(body: { update?: RubikaUpdate; inline_message?: RubikaInlineMessage }): void {
    if (body?.update) this.handleUpdate(body.update);
    else if (body?.inline_message) this.handleInlineMessage(body.inline_message);
  }

  // ------------------------------------------------------------------
  // تبدیل آپدیت‌های روبیکا به شکل تلگرام
  // ------------------------------------------------------------------

  private handleUpdate(update: RubikaUpdate): void {
    const chatId = update.chat_id;
    if (!chatId) return;

    if (update.type === 'StartedBot' && !update.new_message) {
      this.emit('message', this.toMessage(chatId, { message_id: '0', text: '/start', time: Date.now() / 1000 }));
      return;
    }
    if (update.type !== 'NewMessage' || !update.new_message) return;

    const message = update.new_message;
    if (message.sender_type === 'Bot') return;
    if (Date.now() / 1000 - Number(message.time) > MAX_UPDATE_AGE_SECONDS) return;

    // حالت polling: زدن دکمه‌ی کیبورد پایین = زدن دکمه‌ی شیشه‌ای پیام.
    const buttonId = message.aux_data?.button_id;
    if (buttonId && buttonId !== SHARE_PHONE_BUTTON_ID && !message.contact_message) {
      this.emitCallback(chatId, buttonId, this.keypadMessage.get(chatId) ?? message.message_id, message.message_id);
      return;
    }

    this.emit('message', this.toMessage(chatId, message));
  }

  private handleInlineMessage(inline: RubikaInlineMessage): void {
    const buttonId = inline.aux_data?.button_id;
    if (!inline.chat_id || !buttonId) return;
    this.emitCallback(inline.chat_id, buttonId, inline.message_id, `${inline.message_id}:${Date.now()}`);
  }

  private emitCallback(chatId: string, data: string, messageId: string, queryId: string): void {
    const query = {
      id: queryId,
      from: this.toUser(chatId),
      chat_instance: chatId,
      data,
      message: { message_id: messageId, date: Math.floor(Date.now() / 1000), chat: this.toChat(chatId) },
    };
    this.emit('callback_query', query as unknown as TelegramBot.CallbackQuery);
  }

  private toChat(chatId: string): TelegramBot.Chat {
    // b0 = گفتگوی خصوصی کاربر با ربات؛ گروه/کانال‌ها private حساب نمی‌شوند و ربات جوابشان را نمی‌دهد.
    return { id: chatId, type: chatId.startsWith('b0') ? 'private' : 'group' } as unknown as TelegramBot.Chat;
  }

  /**
   * شناسه‌ی کاربر همان chat_id گفتگوی خصوصی با ربات است (روبیکا برای ارسال
   * فقط chat_id می‌خواهد و این شناسه برای هر کاربر ثابت است).
   */
  private toUser(chatId: string): TelegramBot.User {
    return { id: chatId, is_bot: false, first_name: '' } as unknown as TelegramBot.User;
  }

  private toMessage(chatId: string, message: RubikaMessage): TelegramBot.Message {
    const result: Record<string, unknown> = {
      message_id: message.message_id,
      date: Number(message.time) || Math.floor(Date.now() / 1000),
      chat: this.toChat(chatId),
      from: this.toUser(chatId),
    };

    // روبیکا مثل تلگرام user_id صاحب شماره را نمی‌دهد. فقط شماره‌ای که از
    // دکمه‌ی «اشتراک شماره» آمده (و فوروارد نیست) شماره‌ی خود کاربر است؛
    // وگرنه user_id خالی می‌ماند و ربات آن را مال کاربر نمی‌داند.
    const ownNumber = message.aux_data?.button_id === SHARE_PHONE_BUTTON_ID && !message.forwarded_from;
    // دکمه‌ی AskMyPhoneNumber شماره را به شکل text می‌فرستد (مثلاً "989123456789")، نه contact_message.
    const sharedPhone = ownNumber && !message.contact_message ? message.text?.trim() : undefined;
    if (message.contact_message || (sharedPhone && PHONE_TEXT.test(sharedPhone))) {
      result.contact = {
        phone_number: message.contact_message?.phone_number ?? sharedPhone,
        first_name: message.contact_message?.first_name ?? '',
        last_name: message.contact_message?.last_name,
        ...(ownNumber ? { user_id: chatId } : {}),
      };
      return result as unknown as TelegramBot.Message;
    }

    const file = message.file;
    if (file) {
      const extension = extname(file.file_name ?? '').toLowerCase();
      const size = Number(file.size) || undefined;
      if (IMAGE_EXTENSIONS.has(extension)) {
        result.photo = [{ file_id: file.file_id, file_unique_id: file.file_id, width: 0, height: 0, file_size: size }];
      } else if (AUDIO_EXTENSIONS.has(extension)) {
        result.voice = { file_id: file.file_id, file_unique_id: file.file_id, duration: 0, file_size: size };
      } else {
        result.document = { file_id: file.file_id, file_unique_id: file.file_id, file_name: file.file_name, file_size: size };
      }
      if (message.text) result.caption = message.text;
      return result as unknown as TelegramBot.Message;
    }

    if (message.text !== undefined) result.text = message.text;
    return result as unknown as TelegramBot.Message;
  }

  // ------------------------------------------------------------------
  // متدهای هم‌شکل TelegramBot
  // ------------------------------------------------------------------

  async sendMessage(chatId: string, text: string, options?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
    const markup = options?.reply_markup as ReplyMarkup | undefined;
    const body: Record<string, unknown> = { chat_id: chatId, text };
    let keypadAttached = false;

    if (markup?.inline_keyboard) {
      const keypad = toKeypad(markup.inline_keyboard);
      if (this.inlineMode) {
        if (keypad.rows.length) body.inline_keypad = keypad;
      } else if (keypad.rows.length) {
        body.chat_keypad = { ...keypad, resize_keyboard: true };
        body.chat_keypad_type = 'New';
        keypadAttached = true;
      }
    } else if (markup?.keyboard) {
      body.chat_keypad = { ...toKeypad(markup.keyboard), resize_keyboard: true, on_time_keyboard: true };
      body.chat_keypad_type = 'New';
    } else if (markup?.remove_keyboard) {
      body.chat_keypad_type = 'Remove';
    }

    const data = await this.call<{ message_id: string }>('sendMessage', body);
    if (keypadAttached) this.keypadMessage.set(chatId, data.message_id);
    return {
      message_id: data.message_id,
      date: Math.floor(Date.now() / 1000),
      chat: this.toChat(chatId),
      text,
    } as unknown as TelegramBot.Message;
  }

  async editMessageText(text: string, options: TelegramBot.EditMessageTextOptions): Promise<boolean> {
    const chatId = String(options.chat_id);
    await this.call('editMessageText', { chat_id: chatId, message_id: String(options.message_id), text });
    const markup = options.reply_markup as ReplyMarkup | undefined;
    if (markup?.inline_keyboard) {
      await this.editMessageReplyMarkup(markup as TelegramBot.InlineKeyboardMarkup, options);
    }
    return true;
  }

  async editMessageReplyMarkup(
    markup: TelegramBot.InlineKeyboardMarkup,
    options: TelegramBot.EditMessageReplyMarkupOptions,
  ): Promise<boolean> {
    const chatId = String(options.chat_id);
    const messageId = String(options.message_id);
    const keypad = toKeypad(markup.inline_keyboard ?? []);

    if (this.inlineMode) {
      await this.call('editMessageKeypad', { chat_id: chatId, message_id: messageId, inline_keypad: keypad });
      return true;
    }

    // polling: فقط اگر کیبورد پایین چت مال همین پیام باشد عوضش می‌کنیم.
    if (this.keypadMessage.get(chatId) !== messageId) return true;
    if (keypad.rows.length) {
      await this.call('editChatKeypad', { chat_id: chatId, chat_keypad: { ...keypad, resize_keyboard: true }, chat_keypad_type: 'New' });
    } else {
      this.keypadMessage.delete(chatId);
      await this.call('editChatKeypad', { chat_id: chatId, chat_keypad_type: 'Remove' });
    }
    return true;
  }

  async deleteMessage(chatId: string, messageId: string | number): Promise<boolean> {
    const id = String(messageId);
    await this.call('deleteMessage', { chat_id: chatId, message_id: id });
    if (!this.inlineMode && this.keypadMessage.get(chatId) === id) {
      this.keypadMessage.delete(chatId);
      await this.call('editChatKeypad', { chat_id: chatId, chat_keypad_type: 'Remove' }).catch(() => undefined);
    }
    return true;
  }

  async answerCallbackQuery(): Promise<boolean> {
    // روبیکا spinner ندارد.
    return true;
  }

  async setMyCommands(commands: TelegramBot.BotCommand[]): Promise<boolean> {
    await this.call('setCommands', { bot_commands: commands });
    return true;
  }

  async getFileLink(fileId: string): Promise<string> {
    const data = await this.call<{ download_url: string }>('getFile', { file_id: fileId });
    if (!data?.download_url) throw new RubikaBotApiError('getFile', 'NO_DOWNLOAD_URL');
    return data.download_url;
  }

  getFileStream(fileId: string): Readable {
    const stream = new PassThrough();
    void (async () => {
      const url = await this.getFileLink(fileId);
      const response = await axios.get<Readable>(url, { responseType: 'stream', timeout: 60_000 });
      response.data.on('error', (error) => stream.destroy(error));
      response.data.pipe(stream);
    })().catch((error: Error) => stream.destroy(error));
    return stream;
  }

  async downloadFile(fileId: string, directory: string): Promise<string> {
    const url = await this.getFileLink(fileId);
    const extension = extname(new URL(url).pathname) || '.jpg';
    const path = join(directory, `${Date.now()}-${fileId.replace(/[^\w-]/g, '')}${extension}`);
    const response = await axios.get<Readable>(url, { responseType: 'stream', timeout: 60_000 });
    await pipeline(response.data, createWriteStream(path));
    return path;
  }

  // ------------------------------------------------------------------

  private async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    // TODO(موقت): بررسی رفرش کیبورد روبیکا -- بعد از بررسی حذف شود.
    if (method !== 'getUpdates') {
      this.logger.warn(
        `Rubika ${method} msg=${String(body.message_id ?? '-')} keypad=${String(body.chat_keypad_type ?? (body.inline_keypad ? 'inline' : '-'))} text=${String(body.text ?? '').slice(0, 30)}`,
      );
    }
    const { data } = await this.http.post<{ status?: string; data?: T }>(method, body);
    if (data?.status !== 'OK') throw new RubikaBotApiError(method, String(data?.status ?? 'NO_RESPONSE'));
    return data.data as T;
  }
}

function toKeypad(rows: (TelegramBot.InlineKeyboardButton | TelegramBot.KeyboardButton)[][]): RubikaKeypad {
  return {
    rows: rows
      .map((row) => ({
        buttons: row.map((button) => {
          if ('request_contact' in button && button.request_contact) {
            return { id: SHARE_PHONE_BUTTON_ID, type: 'AskMyPhoneNumber' as const, button_text: button.text };
          }
          const id = ('callback_data' in button && button.callback_data) || button.text;
          return { id, type: 'Simple' as const, button_text: button.text };
        }),
      }))
      .filter((row) => row.buttons.length > 0),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
