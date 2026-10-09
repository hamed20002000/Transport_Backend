import { BotAccessService } from './botAccess.service';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MultiBot } from './multiBot';
import { BotPlatform } from './botPlatform';

import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { BotKeyboardService } from './botKeyboard';

import { BotAccountHandler } from './botAccountHandler.service';
import { BotIdentityService } from './botIdentity.service';
import { BotMenuService } from './botMenu.service';
import { BotSessionService } from './botSession.service';
import { BotMessagesService } from './botMessages.service';

import { AccountType } from 'src/domain/enums/subscription';
import { MessengerPlatform } from 'src/domain/enums/messenger';
import { CompanyChannelsDialog } from '../../channel/companyChannelsDialog';
import { BotSessionState } from 'src/domain/enums/botSession';
import { createWriteStream } from 'node:fs';
import { findMenuButton } from './menuTextMatch';
import { actionRows, BotAction, BotDialog, BotDialogRegistry, BotLocation, BotReply } from './botDialog';
import { SubscriptionStatusService } from '../../subscription/subscriptionStatus.service';
import { pipeline } from 'node:stream/promises';
import {
  AGENT_CALLBACK_PREFIX,
  BotAgentBridge,
  BotAgentContext,
} from './botAgentBridge';

import {
  BotCallback,
} from '../../../domain/constants/bot/BotCallback';

@Injectable()
export class MessengerBotService implements OnModuleInit {
  private readonly logger =
    new Logger(MessengerBotService.name);

  constructor(
    private readonly configService:
      ConfigService,

    private readonly botAccountHandler:
      BotAccountHandler,

    private readonly botIdentityService:
      BotIdentityService,

    private readonly botMenuService:
      BotMenuService,

    private readonly botSessionService:
      BotSessionService,

    private readonly messages:
      BotMessagesService,
    private readonly keyboard: BotKeyboardService,
    private readonly botAccessService: BotAccessService,
    private readonly channelsDialog: CompanyChannelsDialog,
    private readonly agentBridge: BotAgentBridge,
    // ربات همه‌ی پیام‌رسان‌ها -- بر اساس پیشوند شناسه پیام‌رسان درست را انتخاب می‌کند.
    private readonly multiBot: MultiBot,
    private readonly dialogs: BotDialogRegistry,
    private readonly subscriptionStatus: SubscriptionStatusService,
  ) {}

  /*
   * =====================================================
   * Init
   * =====================================================
   */

  /**
   * پیام‌های همه‌ی ربات‌ها (تلگرام، بله، روبیکا) از MultiBot می‌رسد. اتصال و
   * راه‌اندازی هر پیام‌رسان با سرویس خودش است (telegram/، bale/، rubika/).
   */
  onModuleInit(): void {
    this.multiBot.on('message', (message: TelegramBot.Message) => {
      void this.handleMessage(message).catch((error: unknown) => {
        this.logger.error(this.getErrorMessage(error));
      });
    });

    this.multiBot.on('edited_message', (message: TelegramBot.Message) => {
      if (!message.location) return;
      void this.handleLocation(message, true).catch((error: unknown) => {
        this.logger.error(this.getErrorMessage(error));
      });
    });

    this.multiBot.on('callback_query', (query: TelegramBot.CallbackQuery) => {
      void this.handleCallbackQuery(query).catch((error: unknown) => {
        this.logger.error(this.getErrorMessage(error));
      });
    });

    void this.multiBot.setMyCommands([
      { command: 'start', description: this.messages.get('commands.start') },
      { command: 'payment', description: this.messages.get('commands.payment') },
    ]);
  }

  /** آپدیت webhook تلگرام: منتظر پردازش می‌ماند تا خطا به تلگرام برگردد و دوباره بفرستد. */
  async handleUpdate(update: TelegramBot.Update): Promise<void> {
    if (update.message) await this.handleMessage(update.message);
    else if (update.edited_message?.location) await this.handleLocation(update.edited_message, true);
    else if (update.callback_query) await this.handleCallbackQuery(update.callback_query);
  }

  /** آیا ربات این پیام‌رسان راه‌اندازی شده است (برای انتخاب مسیر اعلان). */
  hasPlatform(platform: BotPlatform): boolean {
    return this.multiBot.has(platform);
  }

  /*
   * =====================================================
   * Message Router
   * =====================================================
   */

  private async handleMessage(
    message: TelegramBot.Message,
  ): Promise<void> {

    const from =
      message.from;//گرفتن آبجکت کاربر که اطلاعات در آن هست

    if (!from) {
      return;
    }

    const externalUserId =
      from.id.toString();//به دست آوردن شناسه کاربر در پیام رسان که الان برای خود من 263311795 هست

    const chatId =
      message.chat.id.toString();//شناسه چت که در چت خصوصی همون from.idهست ولی در کانال و گروه فرق داره 

    this.keyboard.clearCallbackMessage(chatId);// پاک کردن منوی قبلی از لیست ویرایش ها چون الان داریم متن یا ویس رو پردازش میکنیم

    if (await this.botAccessService.handle(message, from)) return;// بررسی اینکه آیا کاربر به سیستم وصل هست یعنی از قبل حساب دارد یا نه

    if (message.location) { // کاربر لوکیشن معمولی  فرستاده(live location نیست)
      await this.handleLocation(message, false);
      return;
    }

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
      await this.openMainMenu(chatId, externalUserId);

      return;
    }

    if (command === '/payment') {
      await this.botAccountHandler.showPurchaseStatus(
        chatId,
        externalUserId,
      );

      return;
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
        await this.botAccountHandler
          .handleReceipt(
            message,
          );

      if (handled) {
        return;
      }
    }

    if (!(await this.botMenuService.ensureActiveSubscription(chatId, externalUserId))) return;

    // جواب فرم‌ها قبل از تطابق منو: «۲۰» برای وزن بار نباید «گزینه ۲۰» حساب شود.
    // لینک گروه/کانال بعد از «افزودن لینک» در بخش گروه‌ها و کانال‌ها
    if (message.text && await this.handleChannelText(chatId, externalUserId, message.text)) return;
    // مرحله‌های گفتگوهای ثبت‌شده (مثل فرم ثبت بار)
    if (message.text && await this.handleDialogText(chatId, externalUserId, message.text)) return;

    // «گزینه ۲» یا متن دقیق یک دکمه = زدن همان دکمه؛ بقیه به agent
    if (message.text && !command?.startsWith('/') && await this.selectMenuByText(chatId, externalUserId, message.text)) return;

    /*
     * =====================================================
     * AI Agent (voice / free text)
     * =====================================================
     */

    const voice = message.voice ?? message.audio;
    const agent = this.agentBridge.current;
    const agentCtx = agent && (voice || (message.text && !command?.startsWith('/')))
      ? await this.agentContext(chatId, externalUserId)
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
      await this.sendNotice(chatId, this.messages.get('agent.voicePending'));

      return;
    }

    if (message.text) {
      await this.sendNotice(chatId, this.messages.get('errors.unknownMessage'));

      return;
    }

    /*
     * =====================================================
     * Unsupported Message
     * =====================================================
     */

    await this.sendNotice(chatId, this.messages.get('errors.unsupportedMessage'));
  }

  /*
   * =====================================================
   * Callback Router
   * =====================================================
   */

  /**
   * اگر متن (تایپ‌شده یا تبدیل‌شده از ویس) شماره‌ی گزینه یا متن دقیق یکی از
   * دکمه‌های منوی فعلی باشد، همان دکمه را اجرا می‌کند و true برمی‌گرداند؛
   * بقیه‌ی پیام‌ها به agent و ابزارهایش می‌رود (findMenuButton). وسط گفتگو با
   * agent انتخاب منو انجام نمی‌شود.
   */
  async selectMenuByText(
    chatId: string,
    externalUserId: string,
    text: string,
  ): Promise<boolean> {
    const menu = await this.keyboard.getMenuButtons(chatId);
    if (!menu) return false;

    const button = findMenuButton(text, menu.buttons);
    if (!button) return false;

    const agent = this.agentBridge.current;
    if (agent) {
      const ctx = await this.agentContext(chatId, externalUserId);
      if (ctx && agent.isAwaitingAnswer(ctx)) return false;
    }

    await this.handleCallbackQuery({
      id: `text:${Date.now()}`,
      from: { id: externalUserId, is_bot: false, first_name: '' } as unknown as TelegramBot.User,
      chat_instance: chatId,
      data: button.data,
      message: {
        message_id: menu.messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' } as unknown as TelegramBot.Chat,
      },
    }, true);
    return true;
  }

  private async handleCallbackQuery(
    query: TelegramBot.CallbackQuery,
    // از متن/ویس آمده، نه زدن دکمه: callback واقعی‌ای برای جواب دادن نیست و پیام
    // کاربر زیر منوست، پس منوی بعدی پیام جدید است نه ویرایش منوی بالا.
    fromText = false,
  ): Promise<void> {

    const from =
      query.from;

    const externalUserId =
      from.id.toString();

    const chatId =
      query.message?.chat.id.toString();

    if (!chatId) {
      return;
    }

    if (!fromText) {
      // منوی بعدی همین پیام را ویرایش می‌کند تا پیام‌ها در چت زیاد نشوند.
      this.keyboard.useCallbackMessage(chatId, query.message!.message_id);

      /*
       * Telegram spinner را متوقف می‌کنیم.
       */

      try {
        await this.multiBot.answerCallbackQuery(
          query.id,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `answerCallbackQuery failed: ${this.getErrorMessage(
            error,
          )}`,
        );
      }
    }

    if (query.message && await this.botAccessService.handle(query.message, from, query.data ?? '')) return;

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
      BotCallback.MainMenu
    ) {
      await this.openMainMenu(chatId, externalUserId);

      return;
    }

    if (data === BotCallback.PaymentStatus) {
      await this.botAccountHandler.showPurchaseStatus(
        chatId,
        externalUserId,
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
      BotCallback.BuyAccount
    ) {
      await this.botAccountHandler
        .startBuyAccount(
          chatId,
          externalUserId,
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
        BotCallback
          .AccountTypePrefix,
      )
    ) {
      const rawAccountType =
        data.substring(
          BotCallback
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

      await this.botAccountHandler
        .selectAccountType(
          chatId,
          externalUserId,
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
        BotCallback.PlanPrefix,
      )
    ) {
      const planId =
        data.substring(
          BotCallback
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

      await this.botAccountHandler
        .selectPlan(
          chatId,
          externalUserId,
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
      BotCallback.CancelPurchase
    ) {
      await this.botAccountHandler
        .cancelPurchase(
          chatId,
          externalUserId,
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
      BotCallback.RenewSubscription
    ) {
      // تمدید همان خرید است؛ اشتراک جدید از پایان اشتراک فعلی شروع می‌شود.
      await this.botAccountHandler.startBuyAccount(chatId, externalUserId);

      return;
    }

    /*
     * =====================================================
     * My Subscription
     * =====================================================
     */

    if (
      data ===
      BotCallback.MySubscription
    ) {
      await this.showMySubscription(chatId, externalUserId);

      return;
    }

    /*
     * =====================================================
     * Support
     * =====================================================
     */

    if (
      data ===
      BotCallback.Support
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

    if (!(await this.botMenuService.ensureActiveSubscription(chatId, externalUserId))) return;

    if (data.startsWith(AGENT_CALLBACK_PREFIX)) {
      const agent = this.agentBridge.current;
      const agentCtx = agent ? await this.agentContext(chatId, externalUserId) : null;
      if (agent && agentCtx) {
        await agent.handleCallback(agentCtx, data, query.message?.message_id);
      } else {
        await this.openMainMenu(chatId, externalUserId);
      }

      return;
    }

    // گفتگوهای ثبت‌شده (بارهای شرکت، ثبت بار، پیدا کردن بار)
    const dialog = this.dialogs.resolve(data);
    if (dialog) {
      await this.handleDialogAction(chatId, externalUserId, dialog.dialog, dialog.action);

      return;
    }

    if (
      data ===
      BotCallback.DriverLoadRequests
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.driver.loadRequests',
      );

      return;
    }

    if (
      data ===
      BotCallback.DriverActiveTrip
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.driver.activeTrip',
      );

      return;
    }

    if (
      data ===
      BotCallback.DriverReturnLoads
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
      data === BotCallback.CompanyChannels ||
      this.channelsDialog.ownsAction(data)
    ) {
      await this.handleChannelAction(chatId, externalUserId, data);

      return;
    }

    if (
      data ===
      BotCallback.CompanyDriverRequests
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.company.driverRequests',
      );

      return;
    }

    if (
      data ===
      BotCallback.CompanyActiveTrips
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
      BotCallback.BrokerSearchLoads
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.broker.searchLoads',
      );

      return;
    }

    if (
      data ===
      BotCallback.BrokerLoads
    ) {
      await this.sendFeaturePending(
        chatId,
        'menu.broker.loads',
      );

      return;
    }

    if (
      data ===
      BotCallback.BrokerDrivers
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
      `Unknown bot callback: ${data}`,
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

    await this.botSessionService.delete(
      providerUserId,
    );
  }

  /** تأیید خرید برای کاربری که از قبل حساب داشت (رمز جدیدی ساخته نشده). خطای ارسال را پنهان نمی‌کند. */
  async sendSubscriptionActivated(
    providerUserId: string,
    accountType: AccountType,
    expireAt: Date,
  ): Promise<void> {
    await this.requireBot().sendMessage(
      providerUserId,
      this.messages.get('subscription.activated', 'fa', {
        accountType: this.getAccountTypeTitle(accountType),
        expireAt: this.formatDate(expireAt),
      }),
    );
    await this.botSessionService.delete(providerUserId);
  }

  async sendSubscriptionRejected(
    providerUserId: string,
    reason: string,
  ): Promise<void> {
    await this.requireBot().sendMessage(
      providerUserId,
      this.messages.get('subscription.rejected', 'fa', { reason }),
    );
    await this.botSessionService.delete(providerUserId);
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
    options?: TelegramBot.SendMessageOptions,
  ): Promise<number> {
    const message = await this.requireBot()
      .sendMessage(chatId, text, options);

    return message.message_id;
  }

  /** اعلان با دکمه‌های گفتگو (مثل «قبول/رد» درخواست راننده برای شرکت). */
  async sendActionNotification(chatId: string, text: string, actions: BotAction[]): Promise<number> {
    return this.sendNotification(chatId, text, actions.length ? { reply_markup: this.inlineActions(actions) } : undefined);
  }

  /** پین نقشه (مثلاً موقعیت راننده برای شرکت). */
  async sendLocation(chatId: string, latitude: number, longitude: number): Promise<void> {
    await this.requireBot().sendLocation(chatId, latitude, longitude);
  }

  async editNotification(
    chatId: string,
    // شناسه‌ی پیام روبیکا عدد نیست.
    messageId: number | string,
    text: string,
  ): Promise<void> {
    try {
      await this.requireBot().editMessageText(text, {
        chat_id: chatId,
        message_id: messageId as number,
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
   * پیام‌های agent مستقیم با bot فرستاده می‌شوند نه BotKeyboardService؛
   * آن سرویس پیام عملیات قبلی را پاک می‌کند و پیام پیشرفت agent را از بین می‌برد.
   */

  private async agentContext(chatId: string, externalUserId: string): Promise<BotAgentContext | null> {
    const userId = await this.botIdentityService.getUserId(externalUserId);
    return userId ? { chatId, externalUserId, userId } : null;
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

  private requireBot(): MultiBot {
    if (!this.multiBot.configured) {
      throw new ServiceUnavailableException(
        'Messenger bots are disabled.',
      );
    }

    return this.multiBot;
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
   * Channels (shared dialog with WhatsApp)
   * =====================================================
   */

  private async handleChannelAction(chatId: string, externalUserId: string, data: string): Promise<void> {
    const userId = await this.botIdentityService.getUserId(externalUserId);
    if (!userId) {
      await this.openMainMenu(chatId, externalUserId);
      return;
    }
    const ctx = { platform: MessengerPlatform.Bot, externalUserId: externalUserId, userId };
    const reply = data === BotCallback.CompanyChannels
      ? await this.channelsDialog.open(ctx)
      : await this.channelsDialog.handleAction(ctx, data);
    if (reply) await this.sendDialogReply(chatId, externalUserId, reply);
  }

  /** true اگر پیام مربوط به بخش گروه‌ها و کانال‌ها بود و پاسخ داده شد. */
  private async handleChannelText(chatId: string, externalUserId: string, text: string): Promise<boolean> {
    if (!(await this.channelsDialog.hasSession({ platform: MessengerPlatform.Bot, externalUserId: externalUserId }))) {
      return false;
    }
    const userId = await this.botIdentityService.getUserId(externalUserId);
    if (!userId) return false;
    const reply = await this.channelsDialog.handleText(
      { platform: MessengerPlatform.Bot, externalUserId: externalUserId, userId },
      text,
    );
    if (!reply) return false;
    await this.sendDialogReply(chatId, externalUserId, reply);
    return true;
  }

  private async handleDialogAction(chatId: string, externalUserId: string, dialog: BotDialog, action: string): Promise<void> {
    const userId = await this.botIdentityService.getUserId(externalUserId);
    if (!userId) {
      await this.openMainMenu(chatId, externalUserId);
      return;
    }
    const progress = this.progressNotice(chatId);
    try {
      const reply = await dialog.handleAction(
        { platform: MessengerPlatform.Bot, externalUserId, userId, progress: progress.show },
        action,
      );
      if (reply) await this.sendDialogReply(chatId, externalUserId, reply);
    } finally {
      await progress.clear();
    }
  }

  /**
   * پیام موقت «در حال محاسبه» مستقیم با ربات فرستاده می‌شود (نه BotKeyboardService)
   * تا منوی فعلی همچنان در جا ویرایش شود؛ بعد از جواب پاک می‌شود.
   */
  private progressNotice(chatId: string): { show: (text: string) => Promise<void>; clear: () => Promise<void> } {
    let messageId: number | undefined;
    return {
      show: async (text) => {
        if (messageId !== undefined) return;
        try {
          messageId = (await this.multiBot.sendMessage(chatId, text)).message_id;
        } catch (error) {
          this.logger.warn(`Progress notice failed: ${this.getErrorMessage(error)}`);
        }
      },
      clear: async () => {
        if (messageId === undefined) return;
        await this.multiBot.deleteMessage(chatId, messageId).catch(() => undefined);
      },
    };
  }

  /** true اگر یکی از گفتگوهای ثبت‌شده منتظر این متن بود و جواب داد. */
  private async handleDialogText(chatId: string, externalUserId: string, text: string): Promise<boolean> {
    const session = { platform: MessengerPlatform.Bot, externalUserId };
    for (const dialog of this.dialogs.all()) {
      if (!(await dialog.hasSession(session))) continue;
      const userId = await this.botIdentityService.getUserId(externalUserId);
      if (!userId) return false;
      const reply = await dialog.handleText({ ...session, userId }, text);
      if (!reply) continue;
      await this.sendDialogReply(chatId, externalUserId, reply);
      return true;
    }
    return false;
  }

  /** وضعیت اشتراک و آخرین خرید؛ همان متنی که agent برای «اشتراکم چیه» می‌دهد. */
  private async showMySubscription(chatId: string, externalUserId: string): Promise<void> {
    const userId = await this.botIdentityService.getUserId(externalUserId);
    if (!userId) {
      await this.openMainMenu(chatId, externalUserId);
      return;
    }
    const [subscription, order] = await Promise.all([
      this.subscriptionStatus.describeSubscription(userId),
      this.subscriptionStatus.describeLatestOrder(userId),
    ]);
    await this.sendMessage(chatId, `💳 ${subscription.text}

${order.text}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: this.messages.get('menu.main.renewSubscription'), callback_data: BotCallback.RenewSubscription }],
          [{ text: this.messages.get('menu.common.paymentStatus'), callback_data: BotCallback.PaymentStatus }],
          [{ text: this.messages.get('menu.common.mainMenu'), callback_data: BotCallback.MainMenu }],
        ],
      },
    });
  }

  private async sendDialogReply(chatId: string, externalUserId: string, reply: BotReply): Promise<void> {
    // بازگشت: منوی اصلی تلگرام جای پیام «خارج شدید» را می‌گیرد.
    if (reply.closed === 'exit') {
      await this.openMainMenu(chatId, externalUserId);
      return;
    }
    if (reply.photo) {
      // منو باید زیر عکس بیاید: به‌جای ویرایش منوی قبلی (بالای عکس) پیام تازه
      this.keyboard.clearCallbackMessage(chatId);
      try {
        await this.multiBot.sendPhoto(chatId, reply.photo.image, reply.photo.caption);
      } catch (error) {
        this.logger.warn(`Bot sendPhoto failed: ${this.getErrorMessage(error)}`);
      }
    }
    if (reply.locationButton) {
      // «منوی اصلی» متنی است که handleMessage می‌شناسد؛ راه خروج از این کیبورد.
      await this.sendMessage(chatId, reply.text, {
        reply_markup: {
          keyboard: [
            [{ text: reply.locationButton, request_location: true }],
            [{ text: this.messages.get('menu.common.mainMenu') }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return;
    }
    await this.sendMessage(chatId, reply.text, {
      reply_markup: reply.actions.length
        ? this.inlineActions(reply.actions)
        : { inline_keyboard: [[{ text: this.messages.get('menu.common.mainMenu'), callback_data: BotCallback.MainMenu }]] },
    });
  }

  private inlineActions(actions: BotAction[]): TelegramBot.InlineKeyboardMarkup {
    return {
      inline_keyboard: actionRows(actions).map((row) =>
        row.map((action) => (action.url ? { text: action.label, url: action.url } : { text: action.label, callback_data: action.id })),
      ),
    };
  }

  /**
   * لوکیشن کاربر (یا به‌روزرسانی Live Location) به گفتگوهایی که منتظرش هستند
   * (مثل سفر فعال راننده) می‌رود. به‌روزرسانی‌های live بی‌صدا ذخیره می‌شوند.
   */
  private async handleLocation(message: TelegramBot.Message, edited: boolean): Promise<void> {
    const location = message.location;
    const from = message.from;
    if (!location || !from) return;
    const externalUserId = from.id.toString();
    const chatId = message.chat.id.toString();
    const userId = await this.botIdentityService.getUserId(externalUserId);
    if (!userId) {
      if (!edited) await this.openMainMenu(chatId, externalUserId);// این شرط تقریبا هیچ وقت اتفاق نمیفتد چون اگه کاربر از طریق بات ثبت نکند نمیتونه لوکیشن بفرسته
      return;
    }
    const ctx = { platform: MessengerPlatform.Bot, externalUserId, userId };
    const point: BotLocation = {
      latitude: location.latitude,
      longitude: location.longitude,
      livePeriod: (location as { live_period?: number }).live_period,
      edited,
    };

    //چون لوکیشن بدون پیشوند می اید برنامه مجبور هست همه دیالوگ ها رو بررسی کند و اولین دیالوگی که handleLocationرا پیاده سازی کرده اجرا کند
    //اگه مقدار برنگرداند میره به دیالوگ بعدی وگرنه 
    for (const dialog of this.dialogs.all()) {
      const reply = await dialog.handleLocation?.(ctx, point);
      if (!reply) continue;
      if (!edited) await this.sendDialogReply(chatId, externalUserId, reply);
      return;
    }
    if (!edited) await this.sendNotice(chatId, this.messages.get('errors.unsupportedMessage'));
  }


  /**
   * منوی کاربر رو بر حسب شرایط ثبت نامش نشون میده
   * @param chatId 
   * @param externalUserId 
   */
  //#region ------------------------------------- منوی کاربر -------------------------------
  private async openMainMenu(
    chatId: string,
    externalUserId: string,
  ): Promise<void> {
    const state = (await this.botSessionService.get(externalUserId))?.state;
    switch (state) {
      case BotSessionState.SelectingAccountType:
      case BotSessionState.SelectingPlan:
      case BotSessionState.WaitingForReceipt:
      case BotSessionState.UnderReview:
        break;
      default:
        await this.botSessionService.reset(externalUserId);//برای مواردی که کاربر در وسط عملیات باشد بعد کاربر start رو بزنه در این حالت نشست قبلی به در نمیخوره
    }

    await this.botMenuService.showMenuForUser(chatId, externalUserId);
  }
  //#endregion --------------------------------------------------------------------------------

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
                BotCallback.MainMenu,
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

  /**
   * جواب به پیامی که کاربر فرستاده (نه به دکمه): اگر منویی جلوی کاربر هست
   * بدون دکمه می‌رود تا آن منو پاک نشود و کاربر همان‌جا ادامه دهد؛ اگر منویی
   * نیست، دکمه‌ی منوی اصلی می‌گیرد تا کاربر راهی برای ادامه داشته باشد.
   */
  private async sendNotice(chatId: string, text: string): Promise<void> {
    const menu = await this.keyboard.getMenuButtons(chatId).catch(() => null);
    await this.sendMessage(chatId, text, menu ? undefined : this.mainMenuKeyboard());
  }

  private async sendMessage(
    chatId: string,
    text: string,
    options?:
      TelegramBot.SendMessageOptions,
  ): Promise<TelegramBot.Message | null> {

    try {
      return await this.keyboard.sendMessage(chatId,
        text,
        options,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Bot sendMessage failed: ${this.getErrorMessage(
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
