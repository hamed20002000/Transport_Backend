import { Injectable } from '@nestjs/common';
import { AccountType } from '../../../domain/enums/subscription';
import { BotSessionState } from '../../../domain/enums/botSession';
import { BotCallback, BotCallbackBuilder } from '../../../domain/constants/bot/BotCallback';
import { SubscriptionPlanService } from '../../subscription/subscriptionPlan.service';
import { SubscriptionPolicyService } from '../../subscription/subscriptionPolicy.service';
import { SubscriptionAccessService } from '../../subscription/subscriptionAccess.service';
import { BotIdentityService } from './botIdentity.service';
import { BotSessionService } from './botSession.service';
import { BotMessagesService } from './botMessages.service';
import { BotKeyboardService } from './botKeyboard';

@Injectable()
export class BotSubscriptionService {
  constructor(
    private readonly plans: SubscriptionPlanService,
    private readonly identity: BotIdentityService,
    private readonly sessions: BotSessionService,
    private readonly messages: BotMessagesService,
    private readonly keyboard: BotKeyboardService,
    private readonly policy: SubscriptionPolicyService,
    private readonly access: SubscriptionAccessService,
  ) {}

  /** Show available plans and return false when a subscription is required. */

  /**
   * بررسی میکند که آیا کاربر سابسکریپشن دارد یا نه
   * اول بررسی می کند که آیا اصلا سابسکریپشن فعال هستت یا نه
   * بررسی می کند که آیا سابسکریپشن دارد یا نه؟
   * بررسی میکند که آیا اصلا برای نقش سابسکریپشن تعریف شده است؟
   * 
   * @param chatId 
   * @param externalUserId 
   * @returns 
   */

  //#region ---------------------------- بررسی وضعیت سابسکریپشن -----------------------------------
  async ensureActiveSubscription(chatId: string, externalUserId: string): Promise<boolean> {
    const userId = await this.identity.getUserId(externalUserId);
    // linked user: subscription, a driver's own free period, or the general policy (SubscriptionAccessService)
    const access = userId ? await this.access.check(userId) : null;
    if (access ? access.allowed : !(await this.policy.isRequired())) return true;
    
    const accountType = accountTypeForRoles(await this.identity.getMenuRoles(externalUserId));
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
      this.messages.get(!plans.length ? 'account.noActivePlan' : access?.isDriver ? 'account.trialEnded' : 'account.selectPlan'), {
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
  //#endregion ------------------------------------------------------------------------------------------
}

/**
 * نوع حسابی که پلن‌هایش به کاربر نشان داده می‌شود
 * botAccess کاربر لینک‌نشده یا بدون نقش را قبل از اینجا متوقف می‌کند؛
 * null یعنی برای نقش‌های این کاربر پلنی تعریف نشده است
 */
function accountTypeForRoles(roles: string[] | null): AccountType | null {
  if (!roles) return null;
  if (roles.includes('DRIVER')) return AccountType.Driver;
  if (roles.includes('COMPANY') || roles.includes('COMPANY_ADMIN')) return AccountType.Company;
  if (roles.includes('BROKER')) return AccountType.Broker;
  return null;
}
