import { Inject, Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { SUBSCRIPTION_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { ISubscriptionRepository } from '../../domain/repositories/subscription/ISubscriptionRepository';
import { AccountType } from '../../domain/enums/subscription';
import { TelegramSessionState } from '../../domain/enums/telegram';
import { TelegramCallback, TelegramCallbackBuilder } from '../../domain/constants/telegram/TelegramCallback';
import { SubscriptionPlanService } from '../subscription/subscriptionPlan.service';
import { TelegramIdentityService } from './telegramIdentity.service';
import { TelegramSessionService } from './telegramSession.service';
import { TelegramMessagesService } from './telegramMessages.service';
import { TelegramKeyboardService } from './telegramKeyboard';

@Injectable()
export class TelegramSubscriptionService {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: SubscriptionPlanService,
    private readonly identity: TelegramIdentityService,
    private readonly sessions: TelegramSessionService,
    private readonly messages: TelegramMessagesService,
    private readonly keyboard: TelegramKeyboardService,
  ) {}

  /** Show available plans and return false when a subscription is required. */
  async ensureActiveSubscription(bot: TelegramBot, chatId: string, telegramUserId: string): Promise<boolean> {
    const userId = await this.identity.getUserId(telegramUserId);
    if (userId && await this.subscriptions.findActiveByUserId(userId)) return true;
    const roles = await this.identity.getMenuRoles(telegramUserId) ?? [];
    const accountType = roles.includes('DRIVER') ? AccountType.Driver
      : roles.includes('COMPANY') || roles.includes('COMPANY_ADMIN') ? AccountType.Company
      : roles.includes('BROKER') ? AccountType.Broker : null;
    const plans = accountType ? await this.plans.findActiveByAccountType(accountType) : [];
    if (accountType) {
      const session = await this.sessions.get(telegramUserId);
      // Keep receipt upload and tracking available when the user returns to the menu.
      if (![TelegramSessionState.WaitingForReceipt, TelegramSessionState.UnderReview].includes(session?.state as TelegramSessionState)) {
        await this.sessions.set(telegramUserId, { state: TelegramSessionState.SelectingPlan, accountType });
      } else {
        await this.sessions.update(telegramUserId, { accountType });
      }
    }
    await this.keyboard.sendMainMenu(bot, chatId,
      this.messages.get(plans.length ? 'account.selectPlan' : 'account.noActivePlan'), {
        reply_markup: { inline_keyboard: [
          ...plans.map(plan => [{
            text: `${plan.title} — ${new Intl.NumberFormat('fa-IR').format(Number(plan.price))} ${plan.currency}`,
            callback_data: TelegramCallbackBuilder.plan(plan.id),
          }]),
          [{ text: this.messages.get('menu.common.paymentStatus'), callback_data: TelegramCallback.PaymentStatus }],
          [{ text: this.messages.get('menu.common.support'), callback_data: TelegramCallback.Support }],
        ] },
      });
    return false;
  }
}
