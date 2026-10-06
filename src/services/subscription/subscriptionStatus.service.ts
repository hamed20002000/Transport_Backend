import { Inject, Injectable } from '@nestjs/common';

import messages from 'src/application/services/agent/localFiles/messages.json';
import { fa, format } from 'src/application/services/agent/tools/toolKit';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { SUBSCRIPTION_ORDER_REPOSITORY, SUBSCRIPTION_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { ISubscriptionOrderRepository } from 'src/domain/repositories/subscription/ISubscriptionOrderRepository';
import { ISubscriptionRepository } from 'src/domain/repositories/subscription/ISubscriptionRepository';
import { SubscriptionPolicyService } from './subscriptionPolicy.service';

const DAY_MS = 86_400_000;

export interface SubscriptionSummary {
  active: boolean;
  text: string;
}

export interface OrderSummary {
  orderId: string | null;
  status: SubscriptionOrderStatus | null;
  text: string;
}

/**
 * متن وضعیت اشتراک و آخرین خرید کاربر؛ دکمه‌های ربات و ابزارهای agent هر دو
 * از همین استفاده می‌کنند تا جواب در همه‌جا یکی باشد.
 */
@Injectable()
export class SubscriptionStatusService {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptions: ISubscriptionRepository,
    @Inject(SUBSCRIPTION_ORDER_REPOSITORY) private readonly orders: ISubscriptionOrderRepository,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  async describeSubscription(userId: string): Promise<SubscriptionSummary> {
    const subscription = await this.subscriptions.findActiveWithPlanByUserId(userId);
    if (subscription) {
      const days = Math.max(0, Math.ceil((subscription.expireAt.getTime() - Date.now()) / DAY_MS));
      return {
        active: true,
        text: format(messages.subscription.active, {
          plan: subscription.subscriptionPlan?.title ?? '',
          expireAt: this.date(subscription.expireAt),
          days: fa(days),
        }),
      };
    }

    const policy = await this.policy.getStatus();
    const text = policy.required
      ? messages.subscription.none
      : policy.enforced && policy.freeUntil
        ? format(messages.subscription.noneFreeUntil, { freeUntil: this.date(new Date(policy.freeUntil)) })
        : messages.subscription.noneFree;
    return { active: false, text };
  }

  async describeLatestOrder(userId: string): Promise<OrderSummary> {
    const order = await this.orders.findLatestByUserId(userId);
    if (!order) return { orderId: null, status: null, text: messages.subscription.noPurchase };

    const statuses: Record<string, string> = messages.subscription.status;
    const lines = [
      format(messages.subscription.order, {
        plan: order.subscriptionPlan?.title ?? '',
        amount: fa(Number(order.amount).toLocaleString('en-US')),
        currency: order.currency,
        date: this.date(order.createdAt),
        status: statuses[order.status] ?? order.status,
      }),
    ];
    if (order.status === SubscriptionOrderStatus.Rejected && order.rejectionReason) {
      lines.push(format(messages.subscription.rejectionReason, { reason: order.rejectionReason }));
    }
    return { orderId: order.id, status: order.status, text: lines.join('\n') };
  }

  private date(value: Date): string {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  }
}
