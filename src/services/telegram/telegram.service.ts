import { TelegramAccessService } from './telegramAccess.service';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramKeyboardService } from './telegramKeyboard';
import { TelegramTransport } from './telegramTransport';

import { TelegramAccountHandler } from './telegramAccountHandler.service';
import { TelegramIdentityService } from './telegramIdentity.service';
import { TelegramMenuService } from './telegramMenu.service';
import { TelegramSessionService } from './telegramSession.service';
import { TelegramMessagesService } from './telegramMessages.service';

import { AccountType } from 'src/domain/enums/subscription';
import { MessengerPlatform } from 'src/domain/enums/messenger';
import { BotReply, ChannelBotFlowService } from '../channel/channelBotFlow.service';
import { TelegramSessionState } from 'src/domain/enums/telegram';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  AGENT_CALLBACK_PREFIX,
  TelegramAgentBridge,
  TelegramAgentContext,
} from './telegramAgentBridge';

import {
  TelegramCallback,
} from '../../domain/constants/telegram/TelegramCallback';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger =
    new Logger(TelegramService.name);

  private bot?: TelegramBot;
  private transport?: TelegramTransport;
  private ready = false;

  constructor(
    private readonly configService:
      ConfigService,

    private readonly telegramAccountHandler:
      TelegramAccountHandler,

    private readonly telegramIdentityService:
      TelegramIdentityService,

    private readonly telegramMenuService:
      TelegramMenuService,

    private readonly telegramSessionService:
      TelegramSessionService,

    private readonly messages:
      TelegramMessagesService,
    private readonly keyboard: TelegramKeyboardService,
    private readonly telegramAccessService: TelegramAccessService,
    private readonly channelFlow: ChannelBotFlowService,
    private readonly agentBridge: TelegramAgentBridge,
  ) {}

  /*
   * =====================================================
   * Init
   * =====================================================
   */

   async onModuleInit(): Promise<void> {
    const token =
      this.configService.get<string>(
        'TELEGRAM_BOT_TOKEN',
      );

    if (!token) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN is not configured. Telegram bot is disabled.',
      );

      return;
    }

    this.transport = new TelegramTransport(this.configService);

    this.bot = new TelegramBot(
      token,
      {
        polling: false,
      },
    );

    // Telegram being unreachable must not crash the whole application.
    await this.bot.setMyCommands([
      {
        command: 'start',
        description: this.messages.get('commands.start'),
      },
      {
        command: 'payment',
        description: this.messages.get('commands.payment'),
      },
    ]).catch((error: unknown) => {
      this.logger.warn(
        `Failed to set Telegram bot commands: ${this.getErrorMessage(error)}`,
      );
    });

    this.bot.on(
      'message',
      message => {
        void this.handleMessage(
          message,
        ).catch(
          (error: unknown) => {
            this.logger.error(
              this.getErrorMessage(
                error,
              ),
            );
          },
        );
      },
    );

    this.bot.on(
      'callback_query',
      query => {
        void this.handleCallbackQuery(
          query,
        ).catch(
          (error: unknown) => {
            this.logger.error(
              this.getErrorMessage(
                error,
              ),
            );
          },
        );
      },
    );

    this.bot.on(
      'polling_error',
      error => {
        this.logger.error(
          `Telegram polling error: ${error.message}`,
        );
      },
    );

    try {
      await this.transport.start(this.bot);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to start Telegram bot: ${this.getErrorMessage(error)}`,
      );

      return;
    }

    this.ready = true;
    this.logger.log(`Telegram bot started in ${this.transport.mode} mode.`);
  }

  async onModuleDestroy(): Promise<void> {
    this.ready = false;
    if (this.bot?.isPolling()) await this.bot.stopPolling();
    // Keep the remote webhook registered across deployments.
  }

  async receiveWebhook(update: TelegramBot.Update, secret?: string): Promise<void> {
    if (!this.transport) throw new ServiceUnavailableException('Telegram bot is disabled.');
    this.transport.authorize(secret);
    if (!this.ready) throw new ServiceUnavailableException('Telegram bot is not ready.');
    if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
      throw new BadRequestException('Invalid Telegram update.');
    }
    // Await the existing handlers so failures reach Telegram as a non-2xx response.
    if (update.message) await this.handleMessage(update.message);
    else if (update.callback_query) await this.handleCallbackQuery(update.callback_query);
  }

  /*
   * =====================================================
   * Message Router
   * =====================================================
   */

  private async handleMessage(
    message: TelegramBot.Message,
  ): Promise<void> {
    if (!this.bot) {
      return;
    }

    const from =
      message.from;

    if (!from) {
      return;
    }

    const telegramUserId =
      from.id.toString();

    const chatId =
      message.chat.id.toString();

    if (await this.telegramAccessService.handle(this.bot, message, from)) return;

    /*
     * =====================================================
     * /start
     * =====================================================
     */

    const command = message.text?.trim().split(/\s+/)[0].split('@')[0];

    if (
      command === '/start' ||
      message.text === this.messages.get('menu.common.mainMenu')
    ) {
      await this.openMainMenu(chatId, telegramUserId);

      return;
    }

    if (command === '/payment') {
      await this.telegramAccountHandler.showPurchaseStatus(
        this.bot,
        chatId,
        telegramUserId,
      );

      return;
    }

    /*
     * =====================================================
     * Contact
     * =====================================================
     */

    if (message.contact) {
      const handled =
        await this.telegramAccountHandler
          .handleContact(
            this.bot,
            message,
          );

      if (handled) {
        return;
      }
    }

    /*
     * =====================================================
     * Receipt
     * =====================================================
     */

    if (
      message.photo ||
      this.isImageDocument(
        message,
      )
    ) {
      const handled =
        await this.telegramAccountHandler
          .handleReceipt(
            this.bot,
            message,
          );

      if (handled) {
        return;
      }
    }

    if (!(await this.telegramMenuService.ensureActiveSubscription(this.bot, chatId, telegramUserId))) return;

    // لینک گروه/کانال بعد از «افزودن لینک» در بخش گروه‌ها و کانال‌ها
    if (message.text && await this.handleChannelText(chatId, telegramUserId, message.text)) return;

    /*
     * =====================================================
     * AI Agent (voice / free text)
     * =====================================================
     */

    const voice = message.voice ?? message.audio;
    const agent = this.agentBridge.current;
    const agentCtx = agent && (voice || (message.text && !command?.startsWith('/')))
      ? await this.agentContext(chatId, telegramUserId)
      : null;

    if (agent && agentCtx && voice) {
      await agent.handleVoice(agentCtx, { fileId: voice.file_id, fileSize: voice.file_size, duration: voice.duration });
      return;
    }

    if (agent && agentCtx && message.text) {
      await agent.handleText(agentCtx, message.text);
      return;
    }

    if (voice) {
      await this.sendMessage(
        chatId,

        this.messages.get(
          'agent.voicePending',
        ),

        this.mainMenuKeyboard(),
      );

      return;
    }

    /*
     * =====================================================
     * Normal Text (agent disabled or unknown /command)
     * =====================================================
     */

    if (message.text) {
      await this.sendMessage(
        chatId,

        this.messages.get(
          'errors.unknownMessage',
        ),

        this.mainMenuKeyboard(),
      );

      return;
    }

    /*
     * =====================================================
     * Unsupported Message
     * =====================================================
     */

    await this.sendMessage(
      chatId,

      this.messages.get(
        'errors.unsupportedMessage',
      ),

      this.mainMenuKeyboard(),
    );
  }

  /*
   * =====================================================
   * Callback Router
   * =====================================================
   */

  private async handleCallbackQuery(
    query: TelegramBot.CallbackQuery,
  ): Promise<void> {
    if (!this.bot) {
      return;
    }

    const from =
      query.from;

    const telegramUserId =
      from.id.toString();

    const chatId =
      query.message?.chat.id.toString();

    if (!chatId) {
      return;
    }

    /*
     * Telegram spinner را متوقف می‌کنیم.
     */

    try {
      await this.bot.answerCallbackQuery(
        query.id,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `answerCallbackQuery failed: ${this.getErrorMessage(
          error,
        )}`,
      );
    }

    if (query.message && await this.telegramAccessService.handle(this.bot, query.message, from, query.data ?? '')) return;

    const data =
      query.data;

    if (!data) {
      return;
    }

    /*
     * =====================================================
     * Main Menu
     * =====================================================
     */

    if (
      data ===
      TelegramCallback.MainMenu
    ) {
      await this.openMainMenu(chatId, telegramUserId);

      return;
    }

    if (data === TelegramCallback.PaymentStatus) {
      await this.telegramAccountHandler.showPurchaseStatus(
        this.bot,
        chatId,
        telegramUserId,
      );

      return;
    }

    /*
     * =====================================================
     * Buy Account
     * =====================================================
     */

    if (
      data ===
      TelegramCallback.BuyAccount
    ) {
      await this.telegramAccountHandler
        .startBuyAccount(
          this.bot,
          chatId,
          telegramUserId,
        );

      return;
    }

    /*
     * =====================================================
     * Account Type
     * =====================================================
     */

    if (
      data.startsWith(
        TelegramCallback
          .AccountTypePrefix,
      )
    ) {
      const rawAccountType =
        data.substring(
          TelegramCallback
            .AccountTypePrefix
            .length,
        );

      const accountType =
        this.parseAccountType(
          rawAccountType,
        );

      if (!accountType) {
        await this.sendMessage(
          chatId,

          this.messages.get(
            'account.invalidAccountType',
          ),
        );

        return;
      }

      await this.telegramAccountHandler
        .selectAccountType(
          this.bot,
          chatId,
          telegramUserId,
          accountType,
        );

      return;
    }

    /*
     * =====================================================
     * Plan
     * =====================================================
     */

    if (
      data.startsWith(
        TelegramCallback.PlanPrefix,
      )
    ) {
      const planId =
        data.substring(
          TelegramCallback
            .PlanPrefix
            .length,
        );

      if (!planId) {
        await this.sendMessage(
          chatId,

          this.messages.get(
            'account.invalidPlanId',
          ),
        );

        return;
      }

      await this.telegramAccountHandler
        .selectPlan(
          this.bot,
          chatId,
          telegramUserId,
          planId,
        );

      return;
    }

    /*
     * =====================================================
     * Cancel Purchase
     * =====================================================
     */

    if (
      data ===
      TelegramCallback.CancelPurchase
    ) {
      await this.telegramAccountHandler
        .cancelPurchase(
          this.bot,
          chatId,
          telegramUserId,
        );

      return;
    }

    /*
     * =====================================================
     * Renew Subscription
     * =====================================================
     */

    if (
      data ===
      TelegramCallback.RenewSubscription
    ) {
      await this.sendMessage(
        chatId,

        this.messages.get(
          'subscription.renewPending',
        ),

        this.mainMenuKeyboard(),
      );

      return;
    }

    /*
     * =====================================================
     * My Subscription
     * =====================================================
     */

    if (
      data ===
      TelegramCallback.MySubscription
    ) {
      await this.sendMessage(
        chatId,

        this.messages.get(
          'subscription.mySubscriptionPending',
        ),

        this.mainMenuKeyboard(),
      );

      return;
    }

    /*
     * =====================================================
     * Support
     * =====================================================
     */

    if (
      data ===
      TelegramCallback.Support
    ) {
      await this.sendMessage(
        chatId,

        this.messages.get(
          'support.pending',
        ),

        this.mainMenuKeyboard(),
      );

      return;
    }

    /*
     * =====================================================
     * Driver
     * =====================================================
     */

    if (!(await this.telegramMenuService.ensureActiveSubscription(this.bot, chatId, telegramUserId))) return;

    if (data.startsWith(AGENT_CALLBACK_PREFIX)) {
      const agent = this.agentBridge.current;
      const agentCtx = agent ? await this.agentContext(chatId, telegramUserId) : null;
      if (agent && agentCtx) {
        await agent.handleCallback(agentCtx, data, query.message?.message_id);
      } else {
        await this.openMainMenu(chatId, telegramUserId);
      }

      return;
    }

    if (
      data ===
      TelegramCallback.DriverSearchLoads
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.driver.searchLoads',
      );

      return;
    }

    if (
      data ===
      TelegramCallback.DriverLoadRequests
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.driver.loadRequests',
      );

      return;
    }

    if (
      data ===
      TelegramCallback.DriverActiveTrip
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.driver.activeTrip',
      );

      return;
    }

    if (
      data ===
      TelegramCallback.DriverReturnLoads
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.driver.returnLoads',
      );

      return;
    }

    /*
     * =====================================================
     * Company
     * =====================================================
     */

    if (
      data === TelegramCallback.CompanyChannels ||
      this.channelFlow.isAction(data)
    ) {
      await this.handleChannelAction(chatId, telegramUserId, data);

      return;
    }

    if (
      data ===
      TelegramCallback.CompanyCreateLoad
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.company.createLoad',
      );

      return;
    }

    if (
      data ===
      TelegramCallback.CompanyLoads
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.company.loads',
      );

      return;
    }

    if (
      data ===
      TelegramCallback.CompanyDriverRequests
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.company.driverRequests',
      );

      return;
    }

    if (
      data ===
      TelegramCallback.CompanyActiveTrips
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.company.activeTrips',
      );

      return;
    }

    /*
     * =====================================================
     * Broker
     * =====================================================
     */

    if (
      data ===
      TelegramCallback.BrokerSearchLoads
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.broker.searchLoads',
      );

      return;
    }

    if (
      data ===
      TelegramCallback.BrokerLoads
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.broker.loads',
      );

      return;
    }

    if (
      data ===
      TelegramCallback.BrokerDrivers
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.broker.drivers',
      );

      return;
    }

    /*
     * =====================================================
     * Unknown Callback
     * =====================================================
     */

    this.logger.warn(
      `Unknown Telegram callback: ${data}`,
    );

    await this.sendMessage(
      chatId,

      this.messages.get(
        'errors.unknownOperation',
      ),

      this.mainMenuKeyboard(),
    );
  }

  /*
   * =====================================================
   * Send Credentials
   * =====================================================
   *
   * بعداً Approval Flow واقعی
   * به این متد متصل می‌شود.
   */

  async sendAccountCredentials(
    providerUserId: string,
    params: {
      accountType: AccountType;
      username: string;
      temporaryPassword: string;
      expireAt: Date;
    },
  ): Promise<void> {
    const accountTypeTitle =
      this.getAccountTypeTitle(
        params.accountType,
      );

    await this.sendMessage(
      providerUserId,

      this.messages.get(
        'account.credentials',
        'fa',
        {
          accountType:
            accountTypeTitle,

          username:
            params.username,

          password:
            params.temporaryPassword,

          expireAt:
            this.formatDate(
              params.expireAt,
            ),
        },
      ),
    );

    await this.telegramSessionService.delete(
      providerUserId,
    );
  }

  /*
   * =====================================================
   * System Notification
   * =====================================================
   *
   * برخلاف sendMessage خطا را پنهان نمی‌کند تا
   * فرستنده بتواند وضعیت ارسال را ثبت کند.
   */

  async sendNotification(
    chatId: string,
    text: string,
  ): Promise<number> {
    const message = await this.requireBot()
      .sendMessage(chatId, text);

    return message.message_id;
  }

  async editNotification(
    chatId: string,
    messageId: number,
    text: string,
  ): Promise<void> {
    try {
      await this.requireBot().editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
      });
    } catch (error: unknown) {
      // متن از قبل همین بوده -- خطا نیست.
      if (this.getErrorMessage(error).includes('message is not modified')) {
        return;
      }

      throw error;
    }
  }

  /*
   * =====================================================
   * AI Agent
   * =====================================================
   *
   * پیام‌های agent مستقیم با bot فرستاده می‌شوند نه TelegramKeyboardService؛
   * آن سرویس پیام عملیات قبلی را پاک می‌کند و پیام پیشرفت agent را از بین می‌برد.
   */

  private async agentContext(chatId: string, telegramUserId: string): Promise<TelegramAgentContext | null> {
    const userId = await this.telegramIdentityService.getUserId(telegramUserId);
    return userId ? { chatId, telegramUserId, userId } : null;
  }

  async sendAgentMessage(
    chatId: string,
    text: string,
    buttons?: TelegramBot.InlineKeyboardButton[][],
  ): Promise<number> {
    const message = await this.requireBot().sendMessage(
      chatId,
      text,
      buttons ? { reply_markup: { inline_keyboard: buttons } } : undefined,
    );
    return message.message_id;
  }

  async editAgentMessage(
    chatId: string,
    messageId: number,
    text: string,
    buttons?: TelegramBot.InlineKeyboardButton[][],
  ): Promise<void> {
    try {
      await this.requireBot().editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: buttons ?? [] },
      });
    } catch (error: unknown) {
      if (this.getErrorMessage(error).includes('message is not modified')) return;
      throw error;
    }
  }

  /** دکمه‌های پیامی که کاربر رویش کلیک کرده را برمی‌دارد تا دوباره زده نشود. */
  async clearAgentButtons(chatId: string, messageId: number): Promise<void> {
    await this.requireBot()
      .editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId })
      .catch(() => undefined);
  }

  /** فایل را در مسیری که فراخواننده تعیین کرده ذخیره می‌کند (نه نام فایل تلگرام). */
  async downloadAgentFile(fileId: string, destination: string): Promise<void> {
    await pipeline(this.requireBot().getFileStream(fileId), createWriteStream(destination));
  }

  private requireBot(): TelegramBot {
    if (!this.bot) {
      throw new ServiceUnavailableException(
        'Telegram bot is disabled.',
      );
    }

    return this.bot;
  }

  /*
   * =====================================================
   * Feature Pending
   * =====================================================
   */

  private async sendFeaturePending(
    chatId: string,
    featureKey: string,
  ): Promise<void> {
    const featureTitle =
      this.messages.get(
        featureKey,
      );

    await this.sendMessage(
      chatId,

      this.messages.get(
        'features.pending',
        'fa',
        {
          feature:
            featureTitle,
        },
      ),

      this.mainMenuKeyboard(),
    );
  }

  /*
   * =====================================================
   * Main Menu Keyboard
   * =====================================================
   */

  /*
   * =====================================================
   * Channels (shared flow with WhatsApp)
   * =====================================================
   */

  private async handleChannelAction(chatId: string, telegramUserId: string, data: string): Promise<void> {
    const userId = await this.telegramIdentityService.getUserId(telegramUserId);
    if (!userId) {
      await this.openMainMenu(chatId, telegramUserId);
      return;
    }
    const ctx = { platform: MessengerPlatform.Telegram, externalUserId: telegramUserId, userId };
    const reply = data === TelegramCallback.CompanyChannels
      ? await this.channelFlow.open(ctx)
      : await this.channelFlow.handleAction(ctx, data);
    if (reply) await this.sendChannelReply(chatId, telegramUserId, reply);
  }

  /** true اگر پیام مربوط به بخش گروه‌ها و کانال‌ها بود و پاسخ داده شد. */
  private async handleChannelText(chatId: string, telegramUserId: string, text: string): Promise<boolean> {
    if (!(await this.channelFlow.hasSession({ platform: MessengerPlatform.Telegram, externalUserId: telegramUserId }))) {
      return false;
    }
    const userId = await this.telegramIdentityService.getUserId(telegramUserId);
    if (!userId) return false;
    const reply = await this.channelFlow.handleText(
      { platform: MessengerPlatform.Telegram, externalUserId: telegramUserId, userId },
      text,
    );
    if (!reply) return false;
    await this.sendChannelReply(chatId, telegramUserId, reply);
    return true;
  }

  private async sendChannelReply(chatId: string, telegramUserId: string, reply: BotReply): Promise<void> {
    // بازگشت: منوی اصلی تلگرام جای پیام «خارج شدید» را می‌گیرد.
    if (reply.closed === 'exit') {
      await this.openMainMenu(chatId, telegramUserId);
      return;
    }
    await this.sendMessage(chatId, reply.text, {
      reply_markup: {
        inline_keyboard: reply.actions.length
          ? reply.actions.map((action) => [{ text: action.label, callback_data: action.id }])
          : [[{ text: this.messages.get('menu.common.mainMenu'), callback_data: TelegramCallback.MainMenu }]],
      },
    });
  }

  private async openMainMenu(
    chatId: string,
    telegramUserId: string,
  ): Promise<void> {
    if (!this.bot) return;

    const state = (await this.telegramSessionService.get(telegramUserId))?.state;
    switch (state) {
      case TelegramSessionState.SelectingAccountType:
      case TelegramSessionState.SelectingPlan:
      case TelegramSessionState.WaitingForPhone:
      case TelegramSessionState.WaitingForReceipt:
      case TelegramSessionState.UnderReview:
        break;
      default:
        await this.telegramSessionService.reset(telegramUserId);
    }

    if (state === TelegramSessionState.WaitingForPhone) {
      await this.keyboard.sendMessage(this.bot,
        chatId,
        this.messages.get('account.continueFromMenu'),
        { reply_markup: { remove_keyboard: true } },
      );
    }

    await this.telegramMenuService.showMenuForUser(this.bot, chatId, telegramUserId);
  }

  private mainMenuKeyboard():
    TelegramBot.SendMessageOptions {
    return {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                this.messages.get(
                  'menu.common.mainMenu',
                ),

              callback_data:
                TelegramCallback.MainMenu,
            },
          ],
        ],
      },
    };
  }

  /*
   * =====================================================
   * Send Message
   * =====================================================
   */

  private async sendMessage(
    chatId: string,
    text: string,
    options?:
      TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message | null> {
    if (!this.bot) {
      return null;
    }

    try {
      return await this.keyboard.sendMessage(this.bot,
        chatId,
        text,
        options,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Telegram sendMessage failed: ${this.getErrorMessage(
          error,
        )}`,
      );

      return null;
    }
  }

  /*
   * =====================================================
   * Helpers
   * =====================================================
   */

  private parseAccountType(
    value: string,
  ): AccountType | null {
    const accountTypes =
      Object.values(
        AccountType,
      ) as string[];

    if (
      !accountTypes.includes(
        value,
      )
    ) {
      return null;
    }

    return value as AccountType;
  }

  private isImageDocument(
    message: TelegramBot.Message,
  ): boolean {
    return Boolean(
      message.document?.mime_type
        ?.toLowerCase()
        .startsWith('image/'),
    );
  }

  private getAccountTypeTitle(
    accountType: AccountType,
  ): string {
    switch (accountType) {
      case AccountType.Driver:
        return this.messages.get(
          'account.driver',
        );

      case AccountType.Company:
        return this.messages.get(
          'account.company',
        );

      case AccountType.Broker:
        return this.messages.get(
          'account.broker',
        );
    }
  }

  private formatDate(
    date: Date,
  ): string {
    return new Intl.DateTimeFormat(
      'fa-IR',
      {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      },
    ).format(date);
  }

  private getErrorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : String(error);
  }
}
