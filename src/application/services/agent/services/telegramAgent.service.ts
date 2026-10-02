import { randomUUID } from 'node:crypto';
import { botNamespace } from 'src/services/messengerBot/core/botPlatform';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type TelegramBot from 'node-telegram-bot-api';

import { RedisService } from 'src/services/redis/redis.service';
import { MessengerBotService } from 'src/services/messengerBot/core/messengerBot.service';
import {
  AGENT_CALLBACK_PREFIX,
  TelegramAgentBridge,
  TelegramAgentContext,
  TelegramAgentHandler,
  TelegramAgentVoice,
} from 'src/services/messengerBot/core/telegramAgentBridge';
import { TelegramIdentityService } from 'src/services/messengerBot/core/telegramIdentity.service';
import { TelegramMessagesService } from 'src/services/messengerBot/core/telegramMessages.service';
import { UserService } from 'src/services/UserService';
import { TelegramCallback } from 'src/domain/constants/telegram/TelegramCallback';
import { removeVoiceFiles, VOICE_DIR } from 'src/presentation/controllers/agent/agent-uploads';

import { AgentChannelRelay, AgentChannelRelays } from '../agentChannelRelays';
import { AgentRequest, FunctionCallResultType } from '../types';
import { FunctionCallService } from './functioncall.service';
import { SpeechToTextService } from './Speechtotext.service';

type Button = TelegramBot.InlineKeyboardButton;
type SelectionOption = { id: unknown; title: string };

const MAX_VOICE_SECONDS = 120;
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const OPTIONS_PER_PAGE = 8;
// گفتگوی agent هر کاربر تلگرام تا این مدت بدون پیام ادامه پیدا می‌کند.
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

// callback_data حداکثر ۶۴ بایت است؛ فقط کد عمل و یک عدد کوچک در آن می‌رود.
const Action = {
  VoiceRun: `${AGENT_CALLBACK_PREFIX}v:y`,
  VoiceCancel: `${AGENT_CALLBACK_PREFIX}v:n`,
  ConfirmYes: `${AGENT_CALLBACK_PREFIX}c:y`,
  ConfirmNo: `${AGENT_CALLBACK_PREFIX}c:n`,
  GeneratorYes: `${AGENT_CALLBACK_PREFIX}g:y`,
  GeneratorCancel: `${AGENT_CALLBACK_PREFIX}g:n`,
  OptionPrefix: `${AGENT_CALLBACK_PREFIX}o:`,
  PagePrefix: `${AGENT_CALLBACK_PREFIX}p:`,
  NewChat: `${AGENT_CALLBACK_PREFIX}new`,
} as const;

/**
 * agent در ربات تلگرام: متن و پیام صوتی کاربر را به همان pipeline وب/واتس‌اپ
 * می‌دهد و پیشرفت و نتیجه را (از طریق AgentGateway) در همان چت نشان می‌دهد.
 * تأیید حذف، انتخاب از لیست و تأیید متن پیام صوتی با دکمه‌های inline است.
 *
 * وضعیت‌های در انتظار مثل pendingGenerators خود FunctionCallService در حافظه
 * همین process نگه داشته می‌شوند.
 */
@Injectable()
export class TelegramAgentService implements TelegramAgentHandler, AgentChannelRelay, OnModuleInit {
  private readonly logger = new Logger(TelegramAgentService.name);
  private readonly botId: string;

  /** userId -> chatId؛ برای جواب دادن بدون رفتن به دیتابیس. */
  private readonly chats = new Map<string, string>();
  /** chatId -> پیامی که پیشرفت کار در آن ویرایش می‌شود */
  private readonly progressMessages = new Map<string, number>();
  /** telegramUserId -> متن پیام صوتی که منتظر تأیید کاربر است */
  private readonly pendingTranscripts = new Map<string, string>();
  /** userId -> گزینه‌های سؤالی که agent پرسیده */
  private readonly pendingSelections = new Map<string, { message: string; options: SelectionOption[] }>();

  constructor(
    private readonly bridge: TelegramAgentBridge,
    private readonly relays: AgentChannelRelays,
    private readonly telegram: MessengerBotService,
    private readonly identity: TelegramIdentityService,
    private readonly messages: TelegramMessagesService,
    private readonly functionCalls: FunctionCallService,
    private readonly speechToText: SpeechToTextService,
    private readonly users: UserService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.botId = botNamespace(config);
  }

  onModuleInit(): void {
    this.bridge.register(this);
    this.relays.register('telegram', this);
  }

  //#region Incoming (from the bot) -----------------------------------------

  async handleText(ctx: TelegramAgentContext, text: string): Promise<void> {
    this.chats.set(ctx.userId, ctx.chatId);
    const prompt = text.trim();
    if (!prompt) return;

    // پیام جدید یعنی کاربر متن صوتی قبلی را نخواسته
    this.pendingTranscripts.delete(ctx.telegramUserId);

    if (this.functionCalls.hasPendingGenerator(ctx.userId) || this.functionCalls.hasPendingConfirmation(ctx.userId)) {
      await this.telegram.sendAgentMessage(ctx.chatId, this.t('waitingForAnswer'));
      return;
    }

    await this.run(ctx, prompt);
  }

  async handleVoice(ctx: TelegramAgentContext, voice: TelegramAgentVoice): Promise<void> {
    this.chats.set(ctx.userId, ctx.chatId);

    if (voice.duration > MAX_VOICE_SECONDS || (voice.fileSize ?? 0) > MAX_VOICE_BYTES) {
      await this.telegram.sendAgentMessage(ctx.chatId, this.t('voiceTooLong', { seconds: MAX_VOICE_SECONDS }));
      return;
    }

    const statusId = await this.telegram.sendAgentMessage(ctx.chatId, this.t('voiceProcessing'));

    // نام فایل را خودمان می‌سازیم؛ این مسیر داخل دستور ffmpeg/whisper می‌رود.
    mkdirSync(VOICE_DIR, { recursive: true });
    const path = join(VOICE_DIR, `${randomUUID()}.ogg`);

    let text: string;
    try {
      await this.telegram.downloadAgentFile(voice.fileId, path);
      text = (await this.speechToText.transcribeFile(path)).trim();
    } catch (error) {
      this.logger.error(`Telegram voice transcription failed for ${ctx.userId}`, error as Error);
      await this.telegram.editAgentMessage(ctx.chatId, statusId, this.t('voiceFailed'));
      return;
    } finally {
      await removeVoiceFiles(path);
    }

    if (!text) {
      await this.telegram.editAgentMessage(ctx.chatId, statusId, this.t('voiceEmpty'));
      return;
    }

    // مثل واتس‌اپ: متن تشخیص‌داده‌شده اول به کاربر نشان داده می‌شود
    this.pendingTranscripts.set(ctx.telegramUserId, text);
    await this.telegram.editAgentMessage(ctx.chatId, statusId, this.t('voiceConfirm', { text }), [
      [
        { text: this.t('buttons.run'), callback_data: Action.VoiceRun },
        { text: this.t('buttons.cancel'), callback_data: Action.VoiceCancel },
      ],
    ]);
  }

  async handleCallback(ctx: TelegramAgentContext, data: string, messageId?: number): Promise<void> {
    this.chats.set(ctx.userId, ctx.chatId);

    // صفحه‌بندی همان پیام را عوض می‌کند؛ بقیه دکمه‌ها یک‌بار مصرف‌اند.
    if (data.startsWith(Action.PagePrefix)) {
      await this.showSelectionPage(ctx.chatId, ctx.userId, Number(data.slice(Action.PagePrefix.length)), messageId);
      return;
    }
    if (messageId !== undefined) await this.telegram.clearAgentButtons(ctx.chatId, messageId);

    switch (data) {
      case Action.VoiceRun: {
        const text = this.pendingTranscripts.get(ctx.telegramUserId);
        this.pendingTranscripts.delete(ctx.telegramUserId);
        if (!text) {
          await this.telegram.sendAgentMessage(ctx.chatId, this.t('voiceExpired'));
          return;
        }
        await this.run(ctx, text);
        return;
      }
      case Action.VoiceCancel:
        this.pendingTranscripts.delete(ctx.telegramUserId);
        await this.telegram.sendAgentMessage(ctx.chatId, this.t('cancelled'));
        return;
      case Action.ConfirmYes:
      case Action.ConfirmNo:
        await this.functionCalls.resumePendingConfirmation(ctx.userId, data === Action.ConfirmYes, 'telegram');
        return;
      case Action.GeneratorYes:
        await this.answerGenerator(ctx, true, false);
        return;
      case Action.GeneratorCancel:
        this.pendingSelections.delete(ctx.userId);
        await this.answerGenerator(ctx, null, true);
        return;
      case Action.NewChat:
        await this.redis.delete(this.sessionKey(ctx.userId));
        await this.telegram.sendAgentMessage(ctx.chatId, this.t('newChatStarted'));
        return;
    }

    if (data.startsWith(Action.OptionPrefix)) {
      const selection = this.pendingSelections.get(ctx.userId);
      const option = selection?.options[Number(data.slice(Action.OptionPrefix.length))];
      if (!option) {
        await this.telegram.sendAgentMessage(ctx.chatId, this.t('selectionExpired'));
        return;
      }
      this.pendingSelections.delete(ctx.userId);
      await this.telegram.sendAgentMessage(ctx.chatId, `✅ ${option.title}`);
      await this.answerGenerator(ctx, option.id, false);
    }
  }

  //#endregion

  //#region Outgoing (relayed by AgentGateway) ------------------------------

  async sendCurrentTool(userId: string, data: { currentOp?: string }): Promise<void> {
    const chatId = await this.chatIdOf(userId);
    if (!chatId) return;
    await this.showProgress(chatId, `⏳ ${data.currentOp || this.t('working')}`);
  }

  async sendToolResult(userId: string, data: FunctionCallResultType): Promise<void> {
    const chatId = await this.chatIdOf(userId);
    if (!chatId) return;

    if (data.result === 'confirm_required') {
      // پیام پیشرفت همین‌جا تمام می‌شود؛ ادامه کار بعد از پاسخ کاربر پیام تازه می‌گیرد.
      this.progressMessages.delete(chatId);
      await this.askUser(chatId, userId, data);
      return;
    }

    const text =
      data.result === 'success'
        ? this.t('success', { message: data.message || this.t('done') })
        : data.result === 'cancelled'
          ? `🚫 ${data.message ?? this.t('cancelled')}`
          : this.t('error', { message: data.message || this.t('failed') });
    const body = data.continuePrompt ? `${text}\n\n💡 ${data.continuePrompt}` : text;

    if (!data.lastsegment) {
      await this.showProgress(chatId, body);
      return;
    }

    const buttons: Button[][] = [
      [
        { text: this.t('buttons.newChat'), callback_data: Action.NewChat },
        { text: this.messages.get('menu.common.mainMenu'), callback_data: TelegramCallback.MainMenu },
      ],
    ];
    const progressId = this.progressMessages.get(chatId);
    this.progressMessages.delete(chatId);
    if (progressId !== undefined) {
      try {
        await this.telegram.editAgentMessage(chatId, progressId, body, buttons);
        return;
      } catch {
        // پیام قبلی قابل ویرایش نیست (مثلاً پاک شده) -- پیام جدید می‌فرستیم
      }
    }
    await this.telegram.sendAgentMessage(chatId, body, buttons);
  }

  //#endregion

  //#region Helpers ---------------------------------------------------------

  private async run(ctx: TelegramAgentContext, prompt: string): Promise<void> {
    const user = await this.users.getByUserId(ctx.userId);
    const request: AgentRequest = { user: { userId: ctx.userId, username: user.username } };
    const sessionId = await this.sessionOf(ctx.userId);

    this.progressMessages.delete(ctx.chatId);
    await this.showProgress(ctx.chatId, this.t('working'));

    // مثل وب و واتس‌اپ: نتیجه بعداً از AgentGateway می‌رسد.
    this.functionCalls
      .RunFunctionCalling(prompt, request, [], sessionId, 'telegram')
      .catch((error) => this.logger.error(`RunFunctionCalling failed (Telegram): ${ctx.userId}`, error as Error));
  }

  private async answerGenerator(ctx: TelegramAgentContext, value: unknown, cancelled: boolean): Promise<void> {
    if (!this.functionCalls.hasPendingGenerator(ctx.userId)) {
      await this.telegram.sendAgentMessage(ctx.chatId, this.t('selectionExpired'));
      return;
    }
    await this.functionCalls.handleGeneratorResponse(ctx.userId, value, cancelled, 'telegram');
  }

  private async askUser(chatId: string, userId: string, data: FunctionCallResultType): Promise<void> {
    const options = data.data?.data;
    const message = (data.data as { message?: string } | undefined)?.message || data.message || '';

    if (Array.isArray(options) && options.length) {
      this.pendingSelections.set(userId, {
        message: message || this.t('selectOption'),
        options: options.map((option: SelectionOption, index: number) => ({
          id: option.id,
          title: option.title?.trim() || `${index + 1}`,
        })),
      });
      await this.showSelectionPage(chatId, userId, 0);
      return;
    }

    // تأیید ساده: حذف (PendingConfirmationService) یا سؤال بله/نه یک generator
    const [yes, no] = data.isGenerator
      ? [Action.GeneratorYes, Action.GeneratorCancel]
      : [Action.ConfirmYes, Action.ConfirmNo];
    await this.telegram.sendAgentMessage(chatId, message || this.t('confirmDefault'), [
      [
        { text: this.t('buttons.yes'), callback_data: yes },
        { text: this.t('buttons.no'), callback_data: no },
      ],
    ]);
  }

  private async showSelectionPage(chatId: string, userId: string, page: number, messageId?: number): Promise<void> {
    const selection = this.pendingSelections.get(userId);
    if (!selection) {
      await this.telegram.sendAgentMessage(chatId, this.t('selectionExpired'));
      return;
    }

    const pages = Math.ceil(selection.options.length / OPTIONS_PER_PAGE);
    const current = Number.isInteger(page) ? Math.min(Math.max(page, 0), pages - 1) : 0;
    const start = current * OPTIONS_PER_PAGE;

    const buttons: Button[][] = selection.options
      .slice(start, start + OPTIONS_PER_PAGE)
      .map((option, i) => [{ text: option.title.slice(0, 60), callback_data: `${Action.OptionPrefix}${start + i}` }]);

    const navigation: Button[] = [];
    if (current > 0)
      navigation.push({ text: this.t('buttons.previous'), callback_data: `${Action.PagePrefix}${current - 1}` });
    if (current < pages - 1)
      navigation.push({ text: this.t('buttons.next'), callback_data: `${Action.PagePrefix}${current + 1}` });
    if (navigation.length) buttons.push(navigation);
    buttons.push([{ text: this.t('buttons.cancel'), callback_data: Action.GeneratorCancel }]);

    const text = pages > 1 ? `${selection.message}\n\n(${current + 1}/${pages})` : selection.message;
    if (messageId !== undefined) {
      await this.telegram.editAgentMessage(chatId, messageId, text, buttons);
    } else {
      await this.telegram.sendAgentMessage(chatId, text, buttons);
    }
  }

  /** یک پیام پیشرفت برای هر اجرا که مرحله‌به‌مرحله ویرایش می‌شود. */
  private async showProgress(chatId: string, text: string): Promise<void> {
    const messageId = this.progressMessages.get(chatId);
    if (messageId !== undefined) {
      try {
        await this.telegram.editAgentMessage(chatId, messageId, text);
        return;
      } catch {
        // ویرایش نشد -- پیام تازه
      }
    }
    this.progressMessages.set(chatId, await this.telegram.sendAgentMessage(chatId, text));
  }

  private async chatIdOf(userId: string): Promise<string | null> {
    const cached = this.chats.get(userId);
    if (cached) return cached;
    const link = await this.identity.findByUserId(userId);
    if (!link?.chatId) return null;
    this.chats.set(userId, link.chatId);
    return link.chatId;
  }

  private sessionKey(userId: string): string {
    return RedisService.key('telegramAgentSession', this.botId, userId);
  }

  /** گفتگوی جاری کاربر؛ تا «گفتگوی جدید» یا انقضا، context قبلی حفظ می‌شود. */
  private async sessionOf(userId: string): Promise<string> {
    const key = this.sessionKey(userId);
    const existing = await this.redis.get(key);
    if (existing) {
      await this.redis.expire(key, SESSION_TTL_SECONDS);
      return existing;
    }
    const { sessionId } = await this.functionCalls.createNewSession(userId);
    await this.redis.set(key, sessionId, SESSION_TTL_SECONDS);
    return sessionId;
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.messages.get(`agent.${key}`, 'fa', args);
  }

  //#endregion
}
