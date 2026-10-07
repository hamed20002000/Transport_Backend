import { Inject, Injectable } from '@nestjs/common';
import { SUBSCRIPTION_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { ISubscriptionRepository } from '../../../domain/repositories/subscription/ISubscriptionRepository';
import { AccountType } from '../../../domain/enums/subscription';
import { BotSessionState } from '../../../domain/enums/botSession';
import { BotCallback, BotCallbackBuilder } from '../../../domain/constants/bot/BotCallback';
import { SubscriptionPlanService } from '../../subscription/subscriptionPlan.service';
import { SubscriptionPolicyService } from '../../subscription/subscriptionPolicy.service';
import { BotIdentityService } from './botIdentity.service';
import { BotSessionService } from './botSession.service';
import { BotMessagesService } from './botMessages.service';
import { BotKeyboardService } from './botKeyboard';

@Injectable()
export class BotSubscriptionService {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: SubscriptionPlanService,
    private readonly identity: BotIdentityService,
    private readonly sessions: BotSessionService,
    private readonly messages: BotMessagesService,
    private readonly keyboard: BotKeyboardService,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  /** Show available plans and return false when a subscription is required. */
  async ensureActiveSubscription(chatId: string, externalUserId: string): Promise<boolean> {
    if (!(await this.policy.isRequired())) return true;
    const userId = await this.identity.getUserId(externalUserId);
    if (userId && await this.subscriptions.findActiveByUserId(userId)) return true;
    
    const roles = await this.identity.getMenuRoles(externalUserId) ?? [];
    const accountType = roles.includes('DRIVER') ? AccountType.Driver
      : roles.includes('COMPANY') || roles.includes('COMPANY_ADMIN') ? AccountType.Company
      : roles.includes('BROKER') ? AccountType.Broker : null;
    const plans = accountType ? await this.plans.findActiveByAccountType(accountType) : [];
    if (accountType) {
      const session = await this.sessions.get(externalUserId);
      // Keep receipt upload and tracking available when the user returns to the menu.
      if (![BotSessionState.WaitingForReceipt, BotSessionState.UnderReview].includes(session?.state as BotSessionState)) {
        await this.sessions.set(externalUserId, { state: BotSessionState.SelectingPlan, accountType });
      } else {
        await this.sessions.update(externalUserId, { accountType });
      }
    }
    await this.keyboard.sendMainMenu(chatId,
      this.messages.get(plans.length ? 'account.selectPlan' : 'account.noActivePlan'), {
        reply_markup: { inline_keyboard: [
          ...plans.map(plan => [{
            text: `${plan.title} — ${new Intl.NumberFormat('fa-IR').format(Number(plan.price))} ${plan.currency}`,
            callback_data: BotCallbackBuilder.plan(plan.id),
          }]),
          [{ text: this.messages.get('menu.common.paymentStatus'), callback_data: BotCallback.PaymentStatus }],
          [{ text: this.messages.get('menu.common.support'), callback_data: BotCallback.Support }],
        ] },
      });
    return false;
  }
}
