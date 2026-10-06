import {
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import TelegramBot from 'node-telegram-bot-api';
import { MultiBot } from './multiBot';
import { BotKeyboardService } from './botKeyboard';

import {
  mkdir,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

import { AccountType } from 'src/domain/enums/subscription';

import { communicationProviderOf } from './botPlatform';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { SubscriptionOrder } from 'src/domain/entities/subscription/SubscriptionOrder';

import {
  BotSessionState,
} from '../../../domain/enums/botSession';

import {
  BotCallback,
  BotCallbackBuilder,
} from '../../../domain/constants/bot/BotCallback';

import {
  SubscriptionPlanService,
} from '../../subscription/subscriptionPlan.service';

import {
  SubscriptionOrderService,
} from '../../subscription/subscriptionorder.service';

import {
  PaymentReceiptService,
} from '../../subscription/paymentreceipt.service';

import {
  BotSessionService,
} from './botSession.service';

import {
  BotMenuService,
} from './botMenu.service';

import {
  BotMessagesService,
} from './botMessages.service';

import {
  BotIdentityService,
} from './botIdentity.service';

@Injectable()
export class BotAccountHandler {
  private readonly logger =
    new Logger(
      BotAccountHandler.name,
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

    private readonly botSessionService:
      BotSessionService,

    private readonly botMenuService:
      BotMenuService,

    private readonly messages:
      BotMessagesService,
    private readonly keyboard: BotKeyboardService,
    private readonly botIdentityService: BotIdentityService,
    private readonly bot: MultiBot,
  ) {}

  /** How long the user has to pay and upload the receipt after choosing a plan. */
  private get paymentTimeoutSeconds(): number {
    const value = Number(this.configService.get('PAYMENT_TIMEOUT_SECONDS', 600));
    return Number.isSafeInteger(value) && value > 0 ? value : 600;
  }

  async showPurchaseStatus(
    chatId: string,
    externalUserId: string,
  ): Promise<void> {
    try {
      const order = await this.subscriptionOrderService.findOrderForTracking(
        communicationProviderOf(externalUserId),
        externalUserId,
      );

      // A saved payment takes precedence over an outdated channel session.
      if (order && [
        SubscriptionOrderStatus.WaitingForReceipt,
        SubscriptionOrderStatus.ReceiptSubmitted,
        SubscriptionOrderStatus.UnderReview,
      ].includes(order.status)) {
        await this.showOrderStatus(chatId, externalUserId, order);
        return;
      }

      const session = await this.botSessionService.get(externalUserId);
      switch (session?.state) {
        case BotSessionState.SelectingAccountType:
          await this.botMenuService.showAccountTypes(chatId);
          return;
        case BotSessionState.SelectingPlan:
          if (session.accountType) {
            await this.showPlans(chatId, session.accountType);
            return;
          }
          break;
        case BotSessionState.WaitingForReceipt:
          // Payment window still open but no order persisted yet.
          if (!session.orderId && session.subscriptionPlanId) {
            const plan = await this.subscriptionPlanService.findById(session.subscriptionPlanId);
            if (plan) {
              await this.keyboard.sendMessage(chatId, this.messages.get('payment.waitingForReceipt'));
              await this.sendPaymentInformation(
                chatId, plan.price, plan.currency,
                session.expiresAt ? (session.expiresAt - Date.now()) / 1000 : undefined,
              );
              return;
            }
          }
          break;
      }

      if (order) {
        await this.showOrderStatus(chatId, externalUserId, order);
        return;
      }

      await this.keyboard.sendMessage(chatId, this.messages.get('payment.noPurchase'), {
        reply_markup: {
          inline_keyboard: [
            [{
              text: this.messages.get('menu.main.buyAccount'),
              callback_data: BotCallback.BuyAccount,
            }],
            ...this.paymentStatusKeyboard().inline_keyboard,
          ],
        },
      });
    } catch (error: unknown) {
      this.logger.error(`Could not track purchase: ${this.getErrorMessage(error)}`);
      await this.keyboard.sendMessage(chatId, this.messages.get('errors.loadPaymentStatusFailed'), {
        reply_markup: this.paymentStatusKeyboard(),
      });
    }
  }

  private async showOrderStatus(
    chatId: string,
    externalUserId: string,
    order: SubscriptionOrder,
  ): Promise<void> {
    if (order.status === SubscriptionOrderStatus.WaitingForReceipt) {
      await this.botSessionService.set(externalUserId, {
        state: BotSessionState.WaitingForReceipt,
        orderId: order.id,
        accountType: order.accountType,
        subscriptionPlanId: order.subscriptionPlanId,
        phoneNumber: order.phoneNumber,
      });
      await this.keyboard.sendMessage(chatId, this.messages.get('payment.waitingForReceipt'), {
        reply_markup: { remove_keyboard: true },
      });
      await this.sendPaymentInformation(chatId, order.amount, order.currency);
      return;
    }

    let messageKey: string;
    switch (order.status) {
      case SubscriptionOrderStatus.ReceiptSubmitted:
      case SubscriptionOrderStatus.UnderReview:
        await this.botSessionService.set(externalUserId, {
          state: BotSessionState.UnderReview,
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

    await this.keyboard.sendMessage(chatId, this.messages.get(messageKey), {
      reply_markup: this.paymentStatusKeyboard(),
    });

    if ([
      SubscriptionOrderStatus.Approved,
      SubscriptionOrderStatus.Rejected,
      SubscriptionOrderStatus.Cancelled,
    ].includes(order.status)) {
      await this.botSessionService.reset(externalUserId);
    }
  }

  private paymentStatusKeyboard(): TelegramBot.InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{
          text: this.messages.get('menu.common.paymentStatus'),
          callback_data: BotCallback.PaymentStatus,
        }],
        [{
          text: this.messages.get('menu.common.mainMenu'),
          callback_data: BotCallback.MainMenu,
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
    chatId: string,
    externalUserId: string,
  ): Promise<void> {
    await this.botSessionService.reset(
      externalUserId,
    );

    await this.botSessionService.update(
      externalUserId,
      {
        state:
          BotSessionState
            .SelectingAccountType,
      },
    );

    await this.botMenuService
      .showAccountTypes(
        chatId,
      );
  }

  /*
   * =====================================================
   * Select Account Type
   * =====================================================
   */

  async selectAccountType(
    chatId: string,
    externalUserId: string,
    accountType: AccountType,
  ): Promise<void> {
    await this.botSessionService.update(
      externalUserId,
      {
        state:
          BotSessionState
            .SelectingPlan,

        accountType,
      },
    );

    await this.showPlans(
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
        await this.keyboard.sendMessage(chatId,
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
                      BotCallback
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
                BotCallbackBuilder
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
            BotCallback.MainMenu,
        },
      ]);

      await this.keyboard.sendMessage(chatId,

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

      await this.keyboard.sendMessage(chatId,
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
    chatId: string,
    externalUserId: string,
    planId: string,
  ): Promise<void> {
    try {
      const session =
        await this.botSessionService
          .getOrCreate(
            externalUserId,
          );

      if (
        !session.accountType
      ) {
        await this.botSessionService.reset(
          externalUserId,
        );

        await this.keyboard.sendMessage(chatId,
          this.messages.get(
            'account.invalidPurchaseSession',
          ),
        );

        await this.botMenuService
          .showMenuForUser(
            chatId,
            externalUserId,
          );

        return;
      }

      const plan =
        await this.subscriptionPlanService
          .findById(
            planId,
          );

      if (!plan) {
        await this.keyboard.sendMessage(chatId,
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
        await this.keyboard.sendMessage(chatId,
          this.messages.get(
            'account.planNotValidForAccountType',
          ),
        );

        return;
      }

      /*
       * The user is already registered with a verified
       * mobile, so it is reused for the order.
       */
      const link =
        await this.botIdentityService
          .findByExternalUserId(
            externalUserId,
          );

      const phoneNumber =
        link?.user?.mobile;

      if (!phoneNumber) {
        await this.botSessionService.reset(
          externalUserId,
        );

        await this.keyboard.sendMessage(chatId,
          this.messages.get(
            'account.invalidPurchaseSession',
          ),
        );

        return;
      }

      /*
       * The order is created only when the receipt
       * arrives; until then the purchase lives in
       * Redis and expires after the payment window.
       */
      const timeoutSeconds =
        this.paymentTimeoutSeconds;

      await this.botSessionService.set(
        externalUserId,
        {
          state:
            BotSessionState
              .WaitingForReceipt,

          accountType:
            session.accountType,

          subscriptionPlanId:
            plan.id,

          phoneNumber,

          expiresAt:
            Date.now() + timeoutSeconds * 1000,
        },
      );

      await this.sendPaymentInformation(
        chatId,
        plan.price,
        plan.currency,
        timeoutSeconds,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Could not select subscription plan: ${this.getErrorMessage(error)}`,
      );

      await this.keyboard.sendMessage(chatId,
        this.messages.get(
          'errors.selectPlanFailed',
        ),
      );
    }
  }

  /*
   * =====================================================
   * Payment Information
   * =====================================================
   */

  private async sendPaymentInformation(
    chatId: string,
    amount: string,
    currency: string,
    /** Remaining payment window; omitted for orders already saved in the database. */
    remainingSeconds?: number,
  ): Promise<void> {
    const deadline =
      remainingSeconds
        ? `\n\n${this.messages.get(
          'payment.deadline',
          'fa',
          {
            minutes:
              this.formatPrice(
                Math.ceil(remainingSeconds / 60),
              ),
          },
        )}`
        : '';

    const cardNumber =
      this.configService.getOrThrow<string>(
        'CARD_NO',
      );

    const cardOwner =
      this.configService.getOrThrow<string>(
        'CARD_OWNER',
      );

    await this.keyboard.sendMessage(chatId,

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
      ) + deadline,
    );

    await this.keyboard.sendMessage(chatId,
      this.messages.get(
        'payment.receiptRequired',
      ),
      {
        reply_markup: {
          inline_keyboard: [
            [{
              text: this.messages.get('payment.cancel'),
              callback_data: BotCallback.CancelPurchase,
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
    message: TelegramBot.Message,
  ): Promise<boolean> {
    const from =
      message.from;

    if (!from) {
      return false;
    }

    const externalUserId =
      from.id.toString();

    const chatId =
      message.chat.id.toString();

    const session =
      await this.botSessionService.get(
        externalUserId,
      );

    if (
      !session ||
      session.state !==
        BotSessionState
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
      await this.keyboard.sendMessage(chatId,
        this.messages.get(
          'payment.receiptInvalid',
        ),
      );

      return true;
    }

    const outcome =
      await this.botSessionService
        .withReceiptLock(
          externalUserId,
          () =>
            this.processReceipt(
              chatId,
              externalUserId,
              fileId,
            ),
        );

    if (outcome.locked) {
      await this.keyboard.sendMessage(chatId,
        this.messages.get(
          'payment.receiptProcessing',
        ),
      );
    }

    return true;
  }

  /*
   * Runs under the per-user receipt lock, so two photos sent
   * back to back cannot create two orders.
   */
  private async processReceipt(
    chatId: string,
    externalUserId: string,
    fileId: string,
  ): Promise<void> {
    // Re-read: another photo may have completed while we waited.
    const session =
      await this.botSessionService.get(
        externalUserId,
      );

    if (
      !session ||
      session.state !==
        BotSessionState
          .WaitingForReceipt
    ) {
      await this.showPurchaseStatus(
        chatId,
        externalUserId,
      );

      return;
    }

    try {
      let orderId =
        session.orderId;

      /*
       * The database is the source of truth: if a previous
       * submission committed but the session was not updated
       * (e.g. Redis failed), never create a second order.
       */
      if (!orderId) {
        const pending =
          await this.subscriptionOrderService
            .findOrderForTracking(
              communicationProviderOf(externalUserId),
              externalUserId,
            );

        if (
          pending &&
          [
            SubscriptionOrderStatus.ReceiptSubmitted,
            SubscriptionOrderStatus.UnderReview,
          ].includes(pending.status)
        ) {
          await this.showOrderStatus(
            chatId,
            externalUserId,
            pending,
          );

          return;
        }

        if (
          pending?.status ===
            SubscriptionOrderStatus.WaitingForReceipt
        ) {
          orderId =
            pending.id;
        }
      }

      if (
        !orderId &&
        !(
          session.accountType &&
          session.subscriptionPlanId &&
          session.phoneNumber
        )
      ) {
        await this.botSessionService.reset(
          externalUserId,
        );

        await this.keyboard.sendMessage(chatId,
          this.messages.get(
            'account.invalidPurchaseSession',
          ),
        );

        await this.botMenuService
          .showMenuForUser(
            chatId,
            externalUserId,
          );

        return;
      }

      await this.keyboard.sendMessage(chatId,
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
        await this.bot.downloadFile(
          fileId,
          uploadDirectory,
        );

      /*
       * A new order (plan chosen within the payment window)
       * is created in the same transaction as the receipt.
       */
      const receipt =
        await this.paymentReceiptService
          .submitReceipt({
            ...(
              orderId
                ? { orderId }
                : {
                  newOrder: {
                    provider:
                      communicationProviderOf(externalUserId),

                    providerUserId:
                      externalUserId,

                    phoneNumber:
                      session.phoneNumber!,

                    accountType:
                      session.accountType!,

                    subscriptionPlanId:
                      session.subscriptionPlanId!,
                  },
                }
            ),

            imageUrl:
              downloadedFilePath,

            providerFileId:
              fileId,
          });

      await this.botSessionService.update(
        externalUserId,
        {
          state:
            BotSessionState
              .UnderReview,

          orderId:
            receipt.orderId,

          // Back to a normal sliding session once the payment window is done.
          expiresAt:
            undefined,
        },
      );

      await this.keyboard.sendMessage(chatId,
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
                    BotCallback
                      .MainMenu,
                },
              ],
            ],
          },
        },
      );
    } catch (error: unknown) {
      this.logger.error(
        `Could not submit payment receipt: ${this.getErrorMessage(error)}`,
      );

      await this.keyboard.sendMessage(chatId,
        this.messages.get(
          'errors.submitReceiptFailed',
        ),
      );
    }
  }

  /*
   * =====================================================
   * Cancel Purchase
   * =====================================================
   */

  async cancelPurchase(
    chatId: string,
    externalUserId: string,
  ): Promise<void> {
    /*
     * At the moment only the channel session
     * is reset.
     *
     * Database order cancellation can be added
     * to SubscriptionOrderService when the
     * cancellation operation is implemented.
     */

    await this.botSessionService.reset(
      externalUserId,
    );

    await this.keyboard.sendMessage(chatId,
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

    await this.botMenuService
      .showMenuForUser(
        chatId,
        externalUserId,
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
