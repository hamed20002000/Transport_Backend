import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import TelegramBot from 'node-telegram-bot-api';
import { MenuButton } from '../core/menuTextMatch';

// Eitaa's limit for one text or caption
const MAX_TEXT = 4096;
// a message older than this (an outage, a replayed webhook) is not answered: the user has moved on
const MAX_EVENT_AGE_MS = 10 * 60 * 1000;

/**
 * The pace of an ordinary person, not of a program: Eitaa may close an account that sends like a bot. Each chat waits
 * a little (more for a longer text, as if typed) before every message, and the whole account sends at most
 * MAX_PER_MINUTE; the rest queue up instead of being dropped.
 */
const CHAT_GAP_MS = { min: 1200, max: 2600 };
const TYPING_MS_PER_CHAR = 12;
const MAX_TYPING_MS = 2500;
const MAX_PER_MINUTE = 20;

const IMAGE_TYPES = new Set(['image', 'photo']);
const VOICE_TYPES = new Set(['voice', 'audio']);

type ReplyMarkup = {
  inline_keyboard?: TelegramBot.InlineKeyboardButton[][];
  keyboard?: TelegramBot.KeyboardButton[][];
  remove_keyboard?: boolean;
};

/** A GoOmni webhook body (docs/webhook-payload.md); only the fields used here. */
export interface GoOmniEvent {
  event_id: string;
  event: string;
  provider?: string;
  session_id?: string;
  instance_id?: string;
  peer?: { type: string; id: string };
  message_id?: string;
  sender_id?: string;
  direction?: 'incoming' | 'outgoing' | 'unknown';
  timestamp?: string;
  payload?: {
    body?: string;
    kind?: string;
    is_from_me?: boolean | null;
    sender_display_name?: string;
    media?: { type?: string; file_id?: string; name?: string; mime_type?: string; size?: number; download_supported?: boolean } | null;
  };
}

/** Who may be written to: only people who wrote to this account first (EitaaBotService keeps the list). */
export interface EitaaPeerGuard {
  canWrite(peerId: string): Promise<boolean>;
}

/** Same shape as node-telegram-bot-api's errors, so isPermanentTelegramError works for it too. */
export class EitaaApiError extends Error {
  readonly response: { statusCode: number; body: { error_code: number; description: string } };

  constructor(operation: string, code: number, description: string) {
    super(`Eitaa ${operation} failed: ${description}`);
    this.response = { statusCode: code, body: { error_code: code, description } };
  }
}

/**
 * Eitaa has no official two-way bot API, so the bot is an ordinary Eitaa account driven by GoOmni (an independent
 * gateway: github.com/mimalef70/goomni). This client gives it the TelegramBot methods the shared bot uses, the way
 * RubikaBotClient does, so menus, purchase and the agent run unchanged.
 *
 * An account has no buttons: a keyboard becomes a numbered list under the text, and the user answers with the
 * number (or the button's name), which MessengerBotService already understands (findMenuButton). The latest list
 * a chat has seen is announced with 'keyboard_shown', so a number answers the list on screen, a notification's
 * buttons included.
 */
export class EitaaClient extends EventEmitter {
  private readonly logger = new Logger(EitaaClient.name);
  private readonly http: AxiosInstance;
  // per chat: sends wait their turn; the chat's last outgoing message, editable until the user writes again
  private readonly chatQueues = new Map<string, Promise<unknown>>();
  private readonly lastOutgoing = new Map<string, string>();
  private readonly sentAt: number[] = [];

  constructor(
    baseUrl: string,
    basicAuth: string,
    deviceId: string,
    instanceId: string,
    private readonly guard: EitaaPeerGuard,
  ) {
    super();
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout: 60_000,
      headers: {
        Authorization: `Basic ${Buffer.from(basicAuth).toString('base64')}`,
        'X-Device-Id': deviceId,
        'X-Device-Instance': instanceId,
      },
    });
  }

  // ------------------------------------------------------------------
  // Incoming (EitaaBotService verifies the signature and the connection first)
  // ------------------------------------------------------------------

  handleEvent(event: GoOmniEvent): void {
    if (event.event !== 'message' || event.direction !== 'incoming' || event.payload?.is_from_me) return;
    // private chats only: groups and channels the account is in are not the bot's
    if (event.peer?.type !== 'user' || !event.peer.id || event.sender_id !== event.peer.id) return;
    const time = event.timestamp ? Date.parse(event.timestamp) : Date.now();
    if (Date.now() - time > MAX_EVENT_AGE_MS) return;

    const chatId = event.peer.id;
    // the user wrote: what is above is no longer the latest thing they see
    this.lastOutgoing.delete(chatId);
    this.emit('message', this.toMessage(chatId, event, time));
    if (event.message_id) void this.markRead(chatId, event.message_id);
  }

  private toMessage(chatId: string, event: GoOmniEvent, time: number): TelegramBot.Message {
    const payload = event.payload ?? {};
    const result: Record<string, unknown> = {
      message_id: event.message_id,
      date: Math.floor(time / 1000),
      chat: { id: chatId, type: 'private' },
      from: { id: chatId, is_bot: false, first_name: payload.sender_display_name ?? '' },
    };
    const media = payload.media;
    if (media?.type && media.download_supported !== false && event.message_id) {
      // the file is downloaded by message: its id carries the chat and the message
      const fileId = `${chatId}:${event.message_id}`;
      const size = media.size || undefined;
      if (VOICE_TYPES.has(media.type)) {
        result.voice = { file_id: fileId, file_unique_id: fileId, duration: 0, file_size: size, mime_type: media.mime_type };
      } else if (IMAGE_TYPES.has(media.type)) {
        result.photo = [{ file_id: fileId, file_unique_id: fileId, width: 0, height: 0, file_size: size }];
      } else {
        result.document = { file_id: fileId, file_unique_id: fileId, file_name: media.name, mime_type: media.mime_type, file_size: size };
      }
      if (payload.body) result.caption = payload.body;
      return result as unknown as TelegramBot.Message;
    }
    result.text = payload.body ?? '';
    return result as unknown as TelegramBot.Message;
  }

  // ------------------------------------------------------------------
  // TelegramBot-shaped methods
  // ------------------------------------------------------------------

  async sendMessage(chatId: string, text: string, options?: TelegramBot.SendMessageOptions): Promise<TelegramBot.Message> {
    const markup = options?.reply_markup as ReplyMarkup | undefined;
    const { body, buttons } = withOptions(text, markup);
    const messageId = await this.inChat(chatId, body.length, () => this.post('/send/message', { peer: user(chatId), message: body }));
    if (buttons.length) this.emit('keyboard_shown', chatId, messageId, buttons);
    return { message_id: messageId, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: 'private' }, text: body } as unknown as TelegramBot.Message;
  }

  /**
   * In place only while it is still the last thing in the chat (a notice updated before the user replied);
   * otherwise a new message below, as on a phone the edited one would be out of sight above.
   */
  async editMessageText(text: string, options: TelegramBot.EditMessageTextOptions): Promise<TelegramBot.Message | boolean> {
    const chatId = String(options.chat_id);
    const messageId = String(options.message_id);
    if (this.lastOutgoing.get(chatId) !== messageId) {
      return this.sendMessage(chatId, text, { reply_markup: options.reply_markup });
    }
    const { body, buttons } = withOptions(text, options.reply_markup as ReplyMarkup | undefined);
    await this.inChat(chatId, 0, () => this.post(`/message/${encodeURIComponent(messageId)}/update`, { peer: user(chatId), message: body }).then(() => messageId));
    if (buttons.length) this.emit('keyboard_shown', chatId, messageId, buttons);
    return true;
  }

  /** Taking buttons away needs nothing (the list is just text); new buttons come as a new list. */
  async editMessageReplyMarkup(markup: TelegramBot.InlineKeyboardMarkup, options: TelegramBot.EditMessageReplyMarkupOptions): Promise<boolean> {
    const rows = markup?.inline_keyboard ?? [];
    if (!rows.flat().length) return true;
    await this.sendMessage(String(options.chat_id), 'گزینه‌ها:', { reply_markup: markup });
    return true;
  }

  /** Not deleted: an account erasing its messages one after another looks automated, and the chat stays readable. */
  async deleteMessage(): Promise<boolean> {
    return true;
  }

  async answerCallbackQuery(): Promise<boolean> {
    return true;
  }

  async setMyCommands(): Promise<boolean> {
    return true;
  }

  async sendPhoto(chatId: string, photo: Buffer, options?: { caption?: string }): Promise<void> {
    await this.sendMedia(chatId, '/send/image', photo, 'image/jpeg', 'photo.jpg', options?.caption);
  }

  /** Ogg Opus, as Eitaa wants it (GoOmni does not convert). */
  async sendVoice(chatId: string, voice: Buffer, options?: { caption?: string }): Promise<void> {
    await this.sendMedia(chatId, '/send/voice', voice, 'audio/ogg', 'voice.ogg', options?.caption);
  }

  async sendDocument(chatId: string, document: Buffer, options?: { caption?: string }, fileOptions?: { filename: string; contentType: string }): Promise<void> {
    await this.sendMedia(chatId, '/send/file', document, fileOptions?.contentType ?? 'application/octet-stream', fileOptions?.filename ?? 'file', options?.caption);
  }

  /** Eitaa location sends are unverified in GoOmni (they end «unknown»): a map link instead. */
  async sendLocation(chatId: string, latitude: number, longitude: number): Promise<void> {
    await this.sendMessage(chatId, `📍 https://www.google.com/maps?q=${latitude},${longitude}`);
  }

  async getFileLink(): Promise<string> {
    throw new EitaaApiError('getFileLink', 400, 'Eitaa files have no public link');
  }

  getFileStream(fileId: string): Readable {
    const stream = new PassThrough();
    void this.download(fileId)
      .then((source) => {
        source.on('error', (error) => stream.destroy(error));
        source.pipe(stream);
      })
      .catch((error: Error) => stream.destroy(error));
    return stream;
  }

  async downloadFile(fileId: string, directory: string): Promise<string> {
    const path = join(directory, `${Date.now()}-${fileId.replace(/[^\w-]/g, '')}`);
    await pipeline(await this.download(fileId), createWriteStream(path));
    return path;
  }

  // ------------------------------------------------------------------

  private async download(fileId: string): Promise<Readable> {
    const separator = fileId.indexOf(':');
    const chatId = fileId.slice(0, separator);
    const messageId = fileId.slice(separator + 1);
    const response = await this.http.get<Readable>(`/message/${encodeURIComponent(messageId)}/download`, {
      params: { peer: `user:${chatId}` },
      responseType: 'stream',
    });
    return response.data;
  }

  private async sendMedia(chatId: string, route: string, data: Buffer, contentType: string, fileName: string, caption?: string): Promise<void> {
    await this.inChat(chatId, caption?.length ?? 0, async () => {
      const { data: uploaded } = await this.http.post<{ results?: { id?: string } }>('/media', data, {
        // /media takes Ogg as such and everything else as bytes; the kind comes from the send route
        headers: { 'Content-Type': contentType === 'audio/ogg' ? 'audio/ogg' : 'application/octet-stream', 'X-Filename': fileName },
      });
      const mediaId = uploaded?.results?.id;
      if (!mediaId) throw new EitaaApiError('upload', 500, 'no media id');
      return this.post(route, { peer: user(chatId), media_id: mediaId, ...(caption ? { caption: truncate(caption) } : {}) });
    });
  }

  /** The user's message is seen before it is answered, as a person would. */
  private async markRead(chatId: string, messageId: string): Promise<void> {
    await this.http
      .post(`/message/${encodeURIComponent(messageId)}/read`, { peer: user(chatId) }, { headers: { 'Idempotency-Key': randomUUID() } })
      .catch((error: Error) => this.logger.debug(`Eitaa mark read failed: ${error.message}`));
  }

  /**
   * Runs one send for a chat after the chat's previous one, at a person's pace, and only to someone who wrote first.
   * Returns the new message id and remembers it as the chat's latest.
   */
  private inChat(chatId: string, length: number, send: () => Promise<string>): Promise<string> {
    const run = async () => {
      if (!(await this.guard.canWrite(chatId))) throw new EitaaApiError('send', 403, 'this person has not written to the account');
      await sleep(between(CHAT_GAP_MS.min, CHAT_GAP_MS.max) + Math.min(length * TYPING_MS_PER_CHAR, MAX_TYPING_MS));
      await this.accountSlot();
      const messageId = await send();
      this.lastOutgoing.set(chatId, messageId);
      return messageId;
    };
    const previous = this.chatQueues.get(chatId) ?? Promise.resolve();
    const operation = previous.then(run, run);
    const settled = operation.catch(() => undefined);
    this.chatQueues.set(chatId, settled);
    void settled.then(() => {
      if (this.chatQueues.get(chatId) === settled) this.chatQueues.delete(chatId);
    });
    return operation;
  }

  /** At most MAX_PER_MINUTE sends a minute for the whole account; the next one waits for a free slot. */
  private async accountSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.sentAt.length && now - this.sentAt[0] >= 60_000) this.sentAt.shift();
      if (this.sentAt.length < MAX_PER_MINUTE) {
        this.sentAt.push(now);
        return;
      }
      await sleep(60_000 - (now - this.sentAt[0]) + between(200, 800));
    }
  }

  /** A send through GoOmni; «unknown» (maybe sent) is never retried, so it counts as sent without an id. */
  private async post(route: string, body: Record<string, unknown>): Promise<string> {
    try {
      const { data } = await this.http.post<{ results?: { state?: string; message_id?: string; error_code?: string; error_message?: string } }>(route, body, {
        headers: { 'Idempotency-Key': randomUUID() },
      });
      const result = data?.results;
      if (result?.state === 'failed') throw new EitaaApiError(route, 400, result.error_code ?? result.error_message ?? 'failed');
      return result?.message_id ?? `unknown-${randomUUID()}`;
    } catch (error) {
      if (error instanceof EitaaApiError) throw error;
      const status = (error as { response?: { status?: number } }).response?.status;
      // 4xx: the request itself is wrong (except 429 and 408: try again later); otherwise temporary
      const code = status && status >= 400 && status < 500 && status !== 429 && status !== 408 ? 400 : 503;
      throw new EitaaApiError(route, code, (error as Error).message);
    }
  }
}

/**
 * The text with its keyboard written out: inline buttons numbered in the order MessengerBotService counts them
 * (findMenuButton: every callback and link button, row by row), bottom-keyboard buttons as names to type.
 */
export function withOptions(text: string, markup: ReplyMarkup | undefined): { body: string; buttons: MenuButton[] } {
  const buttons: MenuButton[] = (markup?.inline_keyboard ?? [])
    .flat()
    .filter((button) => button.callback_data || button.url)
    .map((button) => (button.url ? { text: button.text, data: '', url: button.url } : { text: button.text, data: button.callback_data! }));
  const lines: string[] = [];
  if (buttons.length) {
    lines.push(...buttons.map((button, index) => `${toPersianDigits(String(index + 1))}. ${button.text}${button.url ? `: ${button.url}` : ''}`));
    lines.push('', 'شماره‌ی گزینه را بفرستید.');
  } else if (markup?.keyboard) {
    // a contact/location request button cannot be pressed here; the text before it already says what to send
    const typed = markup.keyboard.flat().filter((button) => !button.request_contact && !button.request_location);
    if (typed.length) lines.push(...typed.map((button) => `• ${button.text}`));
  }
  const body = lines.length ? `${text}\n\n${lines.join('\n')}` : text;
  return { body: truncate(body), buttons };
}

function truncate(text: string): string {
  const chars = [...text];
  return chars.length > MAX_TEXT ? `${chars.slice(0, MAX_TEXT - 1).join('')}…` : text;
}

const toPersianDigits = (value: string) => value.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const user = (chatId: string) => ({ type: 'user', id: chatId });
const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
