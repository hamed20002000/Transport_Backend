import {
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import TelegramBot from 'node-telegram-bot-api';
import { TelegramKeyboardService } from './telegramKeyboard';

import {
  mkdir,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

import { AccountType } from 'src/domain/enums/subscription';

import { CommunicationProvider } from 'src/domain/enums/subscription';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { SubscriptionOrder } from 'src/domain/entities/subscription/SubscriptionOrder';

import {
  TelegramSessionState,
} from '../../domain/enums/telegram';

import {
  TelegramCallback,
  TelegramCallbackBuilder,
} from '../../domain/constants/telegram/TelegramCallback';

import {
  SubscriptionPlanService,
} from '../subscription/subscriptionPlan.service';

import {
  SubscriptionOrderService,
} from '../subscription/subscriptionorder.service';

import {
  PaymentReceiptService,
} from '../subscription/paymentreceipt.service';

import {
  TelegramSessionService,
} from './telegramSession.service';

import {
  TelegramMenuService,
} from './telegramMenu.service';

import {
  TelegramMessagesService,
} from './telegramMessages.service';

@Injectable()
export class TelegramAccountHandler {
  private readonly logger =
    new Logger(
      TelegramAccountHandler.name,
    );

  constructor(
    private readonly configService:
      ConfigService,

    private readonly subscriptionPlanService:
      SubscriptionPlanService,

    private readonly subscriptionOrderService:
      SubscriptionOrderService,

    private readonly paymentReceiptService:
      PaymentReceiptService,

    private readonly telegramSessionService:
      TelegramSessionService,

    private readonly telegramMenuService:
      TelegramMenuService,

    private readonly messages:
      TelegramMessagesService,
    private readonly keyboard: TelegramKeyboardService,
  ) {}

  async showPurchaseStatus(
    bot: TelegramBot,
    chatId: string,
    telegramUserId: string,
  ): Promise<void> {
    try {
      const order = await this.subscriptionOrderService.findOrderForTracking(
        CommunicationProvider.Telegram,
        telegramUserId,
      );

      // A saved payment takes precedence over an outdated channel session.
      if (order && [
        SubscriptionOrderStatus.WaitingForReceipt,
        SubscriptionOrderStatus.ReceiptSubmitted,
        SubscriptionOrderStatus.UnderReview,
      ].includes(order.status)) {
        await this.showOrderStatus(bot, chatId, telegramUserId, order);
        return;
      }

      const session = await this.telegramSessionService.get(telegramUserId);
      switch (session?.state) {
        case TelegramSessionState.SelectingAccountType:
          await this.telegramMenuService.showAccountTypes(bot, chatId);
          return;
        case TelegramSessionState.SelectingPlan:
          if (session.accountType) {
            await this.showPlans(bot, chatId, session.accountType);
            return;
          }
          break;
        case TelegramSessionState.WaitingForPhone:
          if (session.accountType && session.subscriptionPlanId) {
            await this.selectPlan(bot, chatId, telegramUserId, session.subscriptionPlanId);
            return;
          }
          break;
      }

      if (order) {
        await this.showOrderStatus(bot, chatId, telegramUserId, order);
        return;
      }

      await this.keyboard.sendMessage(bot,chatId, this.messages.get('payment.noPurchase'), {
        reply_markup: {
          inline_keyboard: [
            [{
              text: this.messages.get('menu.main.buyAccount'),
              callback_data: TelegramCallback.BuyAccount,
            }],
            ...this.paymentStatusKeyboard().inline_keyboard,
          ],
        },
      });
    } catch (error: unknown) {
      this.logger.error(`Could not track purchase: ${this.getErrorMessage(error)}`);
      await this.keyboard.sendMessage(bot,chatId, this.messages.get('errors.loadPaymentStatusFailed'), {
        reply_markup: this.paymentStatusKeyboard(),
      });
    }
  }

  private async showOrderStatus(
    bot: TelegramBot,
    chatId: string,
    telegramUserId: string,
    order: SubscriptionOrder,
  ): Promise<void> {
    if (order.status === SubscriptionOrderStatus.WaitingForReceipt) {
      await this.telegramSessionService.set(telegramUserId, {
        state: TelegramSessionState.WaitingForReceipt,
        orderId: order.id,
        accountType: order.accountType,
        subscriptionPlanId: order.subscriptionPlanId,
        phoneNumber: order.phoneNumber,
      });
      await this.keyboard.sendMessage(bot,chatId, this.messages.get('payment.waitingForReceipt'), {
        reply_markup: { remove_keyboard: true },
      });
      await this.sendPaymentInformation(bot, chatId, order.amount, order.currency);
      return;
    }

    let messageKey: string;
    switch (order.status) {
      case SubscriptionOrderStatus.ReceiptSubmitted:
      case SubscriptionOrderStatus.UnderReview:
        await this.telegramSessionService.set(telegramUserId, {
          state: TelegramSessionState.UnderReview,
          orderId: order.id,
        });
        messageKey = 'payment.reviewStatus';
        break;
      case SubscriptionOrderStatus.Approved:
        messageKey = 'payment.approved';
        break;
      case SubscriptionOrderStatus.Rejected:
        messageKey = 'payment.rejected';
        break;
      case SubscriptionOrderStatus.Cancelled:
        messageKey = 'payment.cancelled';
        break;
      default:
        throw new Error(`Unsupported subscription order status: ${order.status}`);
    }

    await this.keyboard.sendMessage(bot,chatId, this.messages.get(messageKey), {
      reply_markup: this.paymentStatusKeyboard(),
    });

    if ([
      SubscriptionOrderStatus.Approved,
      SubscriptionOrderStatus.Rejected,
      SubscriptionOrderStatus.Cancelled,
    ].includes(order.status)) {
      await this.telegramSessionService.reset(telegramUserId);
    }
  }

  private paymentStatusKeyboard(): TelegramBot.InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{
          text: this.messages.get('menu.common.paymentStatus'),
          callback_data: TelegramCallback.PaymentStatus,
        }],
        [{
          text: this.messages.get('menu.common.mainMenu'),
          callback_data: TelegramCallback.MainMenu,
        }],
      ],
    };
  }

  /*
   * =====================================================
   * Start Buy Account
   * =====================================================
   */

  async startBuyAccount(
    bot: TelegramBot,
    chatId: string,
    telegramUserId: string,
  ): Promise<void> {
    await this.telegramSessionService.reset(
      telegramUserId,
    );

    await this.telegramSessionService.update(
      telegramUserId,
      {
        state:
          TelegramSessionState
            .SelectingAccountType,
      },
    );

    await this.telegramMenuService
      .showAccountTypes(
        bot,
        chatId,
      );
  }

  /*
   * =====================================================
   * Select Account Type
   * =====================================================
   */

  async selectAccountType(
    bot: TelegramBot,
    chatId: string,
    telegramUserId: string,
    accountType: AccountType,
  ): Promise<void> {
    await this.telegramSessionService.update(
      telegramUserId,
      {
        state:
          TelegramSessionState
            .SelectingPlan,

        accountType,
      },
    );

    await this.showPlans(
      bot,
      chatId,
      accountType,
    );
  }

  /*
   * =====================================================
   * Show Plans
   * =====================================================
   */

  private async showPlans(
    bot: TelegramBot,
    chatId: string,
    accountType: AccountType,
  ): Promise<void> {
    try {
      const plans =
        await this.subscriptionPlanService
          .findActiveByAccountType(
            accountType,
          );

      if (
        !plans ||
        plans.length === 0
      ) {
        await this.keyboard.sendMessage(bot,
          chatId,
          this.messages.get(
            'account.noActivePlan',
          ),
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      this.messages.get(
                        'menu.common.back',
                      ),

                    callback_data:
                      TelegramCallback
                        .MainMenu,
                  },
                ],
              ],
            },
          },
        );

        return;
      }

      const inlineKeyboard =
        plans.map(
          plan => [
            {
              text:
                this.messages.get(
                  'account.planButton',
                  'fa',
                  {
                    title:
                      plan.title,

                    price:
                      this.formatPrice(
                        plan.price,
                      ),
                  },
                ),

              callback_data:
                TelegramCallbackBuilder
                  .plan(
                    plan.id,
                  ),
            },
          ],
        );

      inlineKeyboard.push([
        {
          text:
            this.messages.get(
              'menu.common.back',
            ),

          callback_data:
            TelegramCallback.MainMenu,
        },
      ]);

      await this.keyboard.sendMessage(bot,
        chatId,

        this.messages.get(
          'account.selectPlan',
        ),

        {
          reply_markup: {
            inline_keyboard:
              inlineKeyboard,
          },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        `Could not load subscription plans: ${this.getErrorMessage(error)}`,
      );

      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'errors.loadPlansFailed',
        ),
      );
    }
  }

  /*
   * =====================================================
   * Select Plan
   * =====================================================
   */

  async selectPlan(
    bot: TelegramBot,
    chatId: string,
    telegramUserId: string,
    planId: string,
  ): Promise<void> {
    try {
      const session =
        await this.telegramSessionService
          .getOrCreate(
            telegramUserId,
          );

      if (
        !session.accountType
      ) {
        await this.telegramSessionService.reset(
          telegramUserId,
        );

        await this.keyboard.sendMessage(bot,
          chatId,
          this.messages.get(
            'account.invalidPurchaseSession',
          ),
        );

        await this.telegramMenuService
          .showMainMenu(
            bot,
            chatId,
            telegramUserId,
          );

        return;
      }

      const plan =
        await this.subscriptionPlanService
          .findById(
            planId,
          );

      if (!plan) {
        await this.keyboard.sendMessage(bot,
          chatId,
          this.messages.get(
            'account.planNotFound',
          ),
        );

        return;
      }

      if (
        plan.accountType !==
        session.accountType
      ) {
        await this.keyboard.sendMessage(bot,
          chatId,
          this.messages.get(
            'account.planNotValidForAccountType',
          ),
        );

        return;
      }

      await this.telegramSessionService.update(
        telegramUserId,
        {
          state:
            TelegramSessionState
              .WaitingForPhone,

          subscriptionPlanId:
            plan.id,
        },
      );

      await this.keyboard.sendMessage(bot,
        chatId,

        this.messages.get(
          'account.planSelected',
          'fa',
          {
            title:
              plan.title,

            price:
              this.formatPrice(
                plan.price,
              ),
          },
        ),

        {
          reply_markup: {
            keyboard: [
              [
                {
                  text:
                    this.messages.get(
                      'account.sendPhoneNumber',
                    ),

                  request_contact:
                    true,
                },
              ],
              [{ text: this.messages.get('menu.common.mainMenu') }],
            ],

            resize_keyboard:
              true,

            one_time_keyboard:
              true,
          },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        `Could not select subscription plan: ${this.getErrorMessage(error)}`,
      );

      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'errors.selectPlanFailed',
        ),
      );
    }
  }

  /*
   * =====================================================
   * Contact
   * =====================================================
   */

  async handleContact(
    bot: TelegramBot,
    message: TelegramBot.Message,
  ): Promise<boolean> {
    const from =
      message.from;

    const contact =
      message.contact;

    if (
      !from ||
      !contact
    ) {
      return false;
    }

    const telegramUserId =
      from.id.toString();

    const chatId =
      message.chat.id.toString();

    const session =
      await this.telegramSessionService.get(
        telegramUserId,
      );

    if (
      !session ||
      session.state !==
        TelegramSessionState
          .WaitingForPhone
    ) {
      return false;
    }

    /*
     * Telegram-specific validation:
     *
     * Contact must belong to
     * the Telegram user himself.
     */

    if (
      contact.user_id == null ||
      contact.user_id !==
        from.id
    ) {
      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'account.invalidContactOwner',
        ),
      );

      return true;
    }

    /*
     * Raw phone number from Telegram.
     *
     * Normalization and final validation
     * are performed inside
     * SubscriptionOrderService.
     *
     * This keeps the business logic
     * reusable for Telegram and WhatsApp.
     */

    const phoneNumber =
      contact.phone_number;

    if (
      !session.accountType ||
      !session.subscriptionPlanId
    ) {
      await this.telegramSessionService.reset(
        telegramUserId,
      );

      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'account.invalidPurchaseSession',
        ),
        {
          reply_markup: {
            remove_keyboard:
              true,
          },
        },
      );

      await this.telegramMenuService
        .showMainMenu(
          bot,
          chatId,
          telegramUserId,
        );

      return true;
    }

    try {
      const order =
        await this.subscriptionOrderService
          .createOrder({
            provider:
              CommunicationProvider
                .Telegram,

            providerUserId:
              telegramUserId,

            phoneNumber,

            accountType:
              session.accountType,

            subscriptionPlanId:
              session.subscriptionPlanId,
          });

      await this.telegramSessionService.update(
        telegramUserId,
        {
          state:
            TelegramSessionState
              .WaitingForReceipt,

          orderId:
            order.id,

          /*
           * Store canonical phone returned
           * through the created order.
           */
          phoneNumber:
            order.phoneNumber,
        },
      );

      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'account.phoneReceived',
        ),
        {
          reply_markup: {
            remove_keyboard:
              true,
          },
        },
      );

      await this.sendPaymentInformation(
        bot,
        chatId,
        order.amount,
        order.currency,
      );

      return true;
    } catch (error: unknown) {
      this.logger.error(
        `Could not create subscription order: ${this.getErrorMessage(error)}`,
      );

      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'errors.createOrderFailed',
        ),
        {
          reply_markup: {
            remove_keyboard:
              true,
          },
        },
      );

      return true;
    }
  }

  /*
   * =====================================================
   * Payment Information
   * =====================================================
   */

  private async sendPaymentInformation(
    bot: TelegramBot,
    chatId: string,
    amount: string,
    currency: string,
  ): Promise<void> {
    const cardNumber =
      this.configService.getOrThrow<string>(
        'SUBSCRIPTION_CARD_NUMBER',
      );

    const cardOwner =
      this.configService.getOrThrow<string>(
        'SUBSCRIPTION_CARD_OWNER',
      );

    await this.keyboard.sendMessage(bot,
      chatId,

      this.messages.get(
        'payment.information',
        'fa',
        {
          amount:
            this.formatPrice(
              amount,
            ),

          currency,

          cardNumber,

          cardOwner,
        },
      ),
    );

    await this.keyboard.sendMessage(bot,
      chatId,
      this.messages.get(
        'payment.receiptRequired',
      ),
      {
        reply_markup: {
          inline_keyboard: [
            [{
              text: this.messages.get('payment.cancel'),
              callback_data: TelegramCallback.CancelPurchase,
            }],
            ...this.paymentStatusKeyboard().inline_keyboard,
          ],
        },
      },
    );
  }

  /*
   * =====================================================
   * Receipt
   * =====================================================
   */

  async handleReceipt(
    bot: TelegramBot,
    message: TelegramBot.Message,
  ): Promise<boolean> {
    const from =
      message.from;

    if (!from) {
      return false;
    }

    const telegramUserId =
      from.id.toString();

    const chatId =
      message.chat.id.toString();

    const session =
      await this.telegramSessionService.get(
        telegramUserId,
      );

    if (
      !session ||
      session.state !==
        TelegramSessionState
          .WaitingForReceipt
    ) {
      return false;
    }

    /*
     * Telegram-specific media handling.
     */

    const fileId =
      this.getImageFileId(
        message,
      );

    if (!fileId) {
      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'payment.receiptInvalid',
        ),
      );

      return true;
    }

    if (!session.orderId) {
      await this.telegramSessionService.reset(
        telegramUserId,
      );

      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'account.invalidPurchaseSession',
        ),
      );

      await this.telegramMenuService
        .showMainMenu(
          bot,
          chatId,
          telegramUserId,
        );

      return true;
    }

    try {
      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'payment.receiptReceived',
        ),
      );

      /*
       * Downloading the media is Telegram-specific.
       *
       * PaymentReceiptService receives only
       * generic receipt information.
       */

      const uploadDirectory =
        join(
          process.cwd(),
          'uploads',
          'payment-receipts',
          'telegram',
        );

      await mkdir(
        uploadDirectory,
        {
          recursive: true,
        },
      );

      const downloadedFilePath =
        await bot.downloadFile(
          fileId,
          uploadDirectory,
        );

      await this.paymentReceiptService
        .submitReceipt({
          orderId:
            session.orderId,

          imageUrl:
            downloadedFilePath,

          providerFileId:
            fileId,
        });

      await this.telegramSessionService.update(
        telegramUserId,
        {
          state:
            TelegramSessionState
              .UnderReview,
        },
      );

      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'payment.underReview',
        ),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    this.messages.get(
                      'menu.common.mainMenu',
                    ),

                  callback_data:
                    TelegramCallback
                      .MainMenu,
                },
              ],
            ],
          },
        },
      );

      return true;
    } catch (error: unknown) {
      this.logger.error(
        `Could not submit payment receipt: ${this.getErrorMessage(error)}`,
      );

      await this.keyboard.sendMessage(bot,
        chatId,
        this.messages.get(
          'errors.submitReceiptFailed',
        ),
      );

      return true;
    }
  }

  /*
   * =====================================================
   * Cancel Purchase
   * =====================================================
   */

  async cancelPurchase(
    bot: TelegramBot,
    chatId: string,
    telegramUserId: string,
  ): Promise<void> {
    /*
     * At the moment only the channel session
     * is reset.
     *
     * Database order cancellation can be added
     * to SubscriptionOrderService when the
     * cancellation operation is implemented.
     */

    await this.telegramSessionService.reset(
      telegramUserId,
    );

    await this.keyboard.sendMessage(bot,
      chatId,
      this.messages.get(
        'account.buyCancelled',
      ),
      {
        reply_markup: {
          remove_keyboard:
            true,
        },
      },
    );

    await this.telegramMenuService
      .showMainMenu(
        bot,
        chatId,
        telegramUserId,
      );
  }

  /*
   * =====================================================
   * Telegram Helpers
   * =====================================================
   */

  private getImageFileId(
    message: TelegramBot.Message,
  ): string | null {
    if (
      message.photo &&
      message.photo.length > 0
    ) {
      return message.photo[
        message.photo.length - 1
      ].file_id;
    }

    if (
      message.document &&
      this.isImageDocument(
        message.document,
      )
    ) {
      return message.document.file_id;
    }

    return null;
  }

  private isImageDocument(
    document: TelegramBot.Document,
  ): boolean {
    return Boolean(
      document.mime_type?.startsWith(
        'image/',
      ),
    );
  }

  private formatPrice(
    value:
      | string
      | number,
  ): string {
    const numericValue =
      typeof value === 'number'
        ? value
        : Number(value);

    if (
      Number.isNaN(
        numericValue,
      )
    ) {
      return String(value);
    }

    return new Intl.NumberFormat(
      'fa-IR',
    ).format(
      numericValue,
    );
  }

  private getErrorMessage(
    error: unknown,
  ): string {
    if (
      error instanceof Error
    ) {
      return error.message;
    }

    return String(error);
  }
}
