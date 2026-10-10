import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import TelegramBot from 'node-telegram-bot-api';
import { BotPlatform, parseBotId, toBotId } from './botPlatform';

/** متدهایی از TelegramBot که ربات اصلی استفاده می‌کند -- RubikaBotClient هم همین‌ها را دارد. */
type PlatformClient = Pick<
  TelegramBot,
  'sendMessage' | 'editMessageText' | 'editMessageReplyMarkup' | 'deleteMessage' | 'setMyCommands' | 'getFileLink'
> & {
  sendLocation(chatId: string, latitude: number, longitude: number): Promise<unknown>;
  sendPhoto(chatId: string, photo: Buffer, options?: { caption?: string }, fileOptions?: object): Promise<unknown>;
  sendVoice(chatId: string, voice: Buffer, options?: { caption?: string }, fileOptions?: object): Promise<unknown>;
  answerCallbackQuery(id: string): Promise<boolean>;
  getFileStream(fileId: string): Readable;
  downloadFile(fileId: string, directory: string): Promise<string>;
  on(event: string, listener: (...args: any[]) => void): unknown;
};

/**
 * یک «ربات» با رابط TelegramBot که پشتش ربات‌های تلگرام، بله و روبیکا هستند.
 * شناسه‌های چت/کاربر/فایل/callback پیام‌رسان‌های غیرتلگرام با پیشوند
 * (bale:… ، rubika:…) به کد ربات داده می‌شوند و هر ارسال بر اساس همین
 * پیشوند به پیام‌رسان درست می‌رود. پس MessengerBotService و سرویس‌هایش (منو،
 * خرید، agent، اعلان‌ها) بدون تغییر روی هر سه کار می‌کنند.
 */
@Injectable()
export class MultiBot extends EventEmitter {
  private readonly logger = new Logger(MultiBot.name);
  private readonly clients = new Map<BotPlatform, PlatformClient>();
  private commands: TelegramBot.BotCommand[] = [];

  /**
   * سرویس هر پیام‌رسان (TelegramBotService، BaleBotService، RubikaBotService)
   * کلاینتش را اینجا ثبت می‌کند؛ از این به بعد پیام‌هایش به MessengerBotService
   * می‌رسد و ارسال‌ها با پیشوند شناسه به آن می‌رود.
   */
  register(platform: BotPlatform, client: object): void {
    const typed = client as unknown as PlatformClient;
    this.clients.set(platform, typed);
    if (this.commands.length) void this.applyCommands(platform, typed);

    typed.on('message', (message: TelegramBot.Message) => {
      this.emit('message', prefixMessage(platform, message));
    });
    // Live Location تلگرام: هر به‌روزرسانی موقعیت یک edited_message است.
    typed.on('edited_message', (message: TelegramBot.Message) => {
      this.emit('edited_message', prefixMessage(platform, message));
    });
    typed.on('callback_query', (query: TelegramBot.CallbackQuery) => {
      this.emit('callback_query', prefixCallbackQuery(platform, query));
    });
    typed.on('polling_error', (error: Error) => {
      this.logger.error(`${platform} polling error: ${error?.message}`);
    });
  }

  has(platform: BotPlatform): boolean {
    return this.clients.has(platform);
  }

  get configured(): boolean {
    return this.clients.size > 0;
  }

  // ------------------------------------------------------------------

  async sendMessage(chatId: string | number, text: string, options?: TelegramBot.SendMessageOptions) {
    const { platform, client, nativeId } = this.route(chatId);
    const message = await client.sendMessage(nativeId, text, options);
    return prefixMessage(platform, message);
  }

  async sendLocation(chatId: string | number, latitude: number, longitude: number) {
    const { client, nativeId } = this.route(chatId);
    await client.sendLocation(nativeId, latitude, longitude);
  }

  /** عکس (مثلاً نقشه‌ی مسیر و جایگاه‌های سوخت) با زیرنویس. */
  async sendPhoto(chatId: string | number, photo: Buffer, caption?: string) {
    const { client, nativeId } = this.route(chatId);
    await client.sendPhoto(nativeId, photo, caption ? { caption } : {}, { filename: 'map.jpg', contentType: 'image/jpeg' });
  }

  /** پیام صوتی ogg/opus (تلگرام و بله sendVoice؛ روبیکا فایل Voice). */
  async sendVoice(chatId: string | number, voice: Buffer, caption?: string) {
    const { client, nativeId } = this.route(chatId);
    await client.sendVoice(nativeId, voice, caption ? { caption } : {}, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  }

  async editMessageText(text: string, options: TelegramBot.EditMessageTextOptions) {
    const { client, nativeId } = this.route(options.chat_id!);
    return client.editMessageText(text, { ...options, chat_id: nativeId });
  }

  async editMessageReplyMarkup(
    markup: TelegramBot.InlineKeyboardMarkup,
    options: TelegramBot.EditMessageReplyMarkupOptions,
  ) {
    const { client, nativeId } = this.route(options.chat_id!);
    return client.editMessageReplyMarkup(markup, { ...options, chat_id: nativeId });
  }

  async deleteMessage(chatId: string | number, messageId: number) {
    const { client, nativeId } = this.route(chatId);
    return client.deleteMessage(nativeId, messageId);
  }

  async answerCallbackQuery(queryId: string) {
    const { client, nativeId } = this.route(queryId);
    return client.answerCallbackQuery(nativeId);
  }

  /** دستورهای ربات روی همه‌ی پیام‌رسان‌ها (ثبت‌شده و بعدی)؛ خطای یکی بقیه را متوقف نمی‌کند. */
  async setMyCommands(commands: TelegramBot.BotCommand[]): Promise<boolean> {
    this.commands = commands;
    await Promise.all([...this.clients].map(([platform, client]) => this.applyCommands(platform, client)));
    return true;
  }

  private async applyCommands(platform: BotPlatform, client: PlatformClient): Promise<void> {
    await client.setMyCommands(this.commands).catch((error: Error) =>
      this.logger.warn(`Failed to set ${platform} bot commands: ${error.message}`),
    );
  }

  getFileStream(fileId: string): Readable {
    const { client, nativeId } = this.route(fileId);
    return client.getFileStream(nativeId);
  }

  async downloadFile(fileId: string, directory: string): Promise<string> {
    const { client, nativeId } = this.route(fileId);
    return client.downloadFile(nativeId, directory);
  }

  async getFileLink(fileId: string): Promise<string> {
    const { client, nativeId } = this.route(fileId);
    return client.getFileLink(nativeId);
  }

  private route(id: string | number): { platform: BotPlatform; client: PlatformClient; nativeId: string } {
    const { platform, nativeId } = parseBotId(id);
    const client = this.clients.get(platform);
    if (!client) throw new Error(`${platform} bot is not configured.`);
    return { platform, client, nativeId };
  }
}

// ------------------------------------------------------------------
// افزودن پیشوند پلتفرم به شناسه‌های دریافتی (تلگرام بدون پیشوند می‌ماند)
// ------------------------------------------------------------------

type Mutable = Record<string, any>;

function prefixMessage(platform: BotPlatform, message: TelegramBot.Message): TelegramBot.Message {
  if (platform === 'telegram' || !message) return message;
  const m = message as unknown as Mutable;
  const id = (value: unknown) => (value === undefined || value === null ? value : toBotId(platform, value as string));

  if (m.chat) m.chat = { ...m.chat, id: id(m.chat.id) };
  if (m.from) m.from = { ...m.from, id: id(m.from.id) };
  if (m.contact?.user_id !== undefined && m.contact?.user_id !== null) {
    m.contact = { ...m.contact, user_id: id(m.contact.user_id) };
  }
  if (Array.isArray(m.photo)) m.photo = m.photo.map((p: Mutable) => ({ ...p, file_id: id(p.file_id) }));
  for (const key of ['document', 'voice', 'audio', 'video', 'video_note']) {
    if (m[key]?.file_id) m[key] = { ...m[key], file_id: id(m[key].file_id) };
  }
  return message;
}

function prefixCallbackQuery(platform: BotPlatform, query: TelegramBot.CallbackQuery): TelegramBot.CallbackQuery {
  if (platform === 'telegram') return query;
  const q = query as unknown as Mutable;
  q.id = toBotId(platform, q.id);
  if (q.from) q.from = { ...q.from, id: toBotId(platform, q.from.id) };
  if (q.message) q.message = prefixMessage(platform, q.message);
  return query;
}
