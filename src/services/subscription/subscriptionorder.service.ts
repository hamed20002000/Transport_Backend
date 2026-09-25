import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { SubscriptionOrder } from 'src/domain/entities/subscription/SubscriptionOrder';

import {
  AccountType,
  CommunicationProvider,
  SubscriptionOrderStatus,
} from 'src/domain/enums/subscription';

import { ISubscriptionPlanRepository } from 'src/domain/repositories/subscription/ISubscriptionPlanRepository';
import { ISubscriptionOrderRepository } from 'src/domain/repositories/subscription/ISubscriptionOrderRepository';

import {
  SUBSCRIPTION_ORDER_REPOSITORY,
  SUBSCRIPTION_PLAN_REPOSITORY,
} from '../../domain/repositories/repository.tokens';

export interface CreateSubscriptionOrderParams {
  provider: CommunicationProvider;
  providerUserId: string;
  phoneNumber: string;
  accountType: AccountType;
  subscriptionPlanId: string;
}

@Injectable()
export class SubscriptionOrderService {
  constructor(
    @Inject(SUBSCRIPTION_PLAN_REPOSITORY)
    private readonly planRepository:
      ISubscriptionPlanRepository,

    @Inject(SUBSCRIPTION_ORDER_REPOSITORY)
    private readonly orderRepository:
      ISubscriptionOrderRepository,
  ) {}

  async findOrderForTracking(
    provider: CommunicationProvider,
    providerUserId: string,
  ): Promise<SubscriptionOrder | null> {
    const pendingOrder = await this.orderRepository.findPendingByProviderUser(
      provider,
      providerUserId,
    );

    return pendingOrder ?? this.orderRepository.findLatestByProviderUser(
      provider,
      providerUserId,
    );
  }

  async createOrder(
    params: CreateSubscriptionOrderParams,
  ): Promise<SubscriptionOrder> {
    return this.orderRepository.save(
      await this.buildOrder(params),
    );
  }

  /**
   * Validates and prepares an order without saving it, so callers can
   * persist it together with related rows in one transaction.
   */
  async buildOrder(
    params: CreateSubscriptionOrderParams,
  ): Promise<SubscriptionOrder> {
    const providerUserId =
      params.providerUserId.trim();

    if (!providerUserId) {
      throw new BadRequestException(
        'Provider user id is required',
      );
    }

    const phoneNumber =
      this.normalizePhone(
        params.phoneNumber,
      );

    if (!this.isValidIranMobile(phoneNumber)) {
      throw new BadRequestException(
        'Invalid phone number',
      );
    }

    const plan =
      await this.planRepository.findById(
        params.subscriptionPlanId,
      );

    if (!plan) {
      throw new NotFoundException(
        'Subscription plan not found',
      );
    }

    if (
      plan.accountType !==
      params.accountType
    ) {
      throw new BadRequestException(
        'Subscription plan does not belong to selected account type',
      );
    }

    const order =
      new SubscriptionOrder();

    order.provider =
      params.provider;

    order.providerUserId =
      providerUserId;

    order.phoneNumber =
      phoneNumber;

    order.accountType =
      params.accountType;

    order.subscriptionPlanId =
      plan.id;

    /*
     * Snapshot payment information.
     *
     * Even if the plan price changes later,
     * this order keeps the original amount.
     */
    order.amount =
      plan.price;

    order.currency =
      plan.currency;

    order.status =
      SubscriptionOrderStatus
        .WaitingForReceipt;

    return order;
  }

  private normalizePhone(
    phone: string,
  ): string {
    let value =
      phone
        .trim()
        .replace(
          /[\s()-]/g,
          '',
        );

    if (
      value.startsWith('+98')
    ) {
      value =
        `0${value.substring(3)}`;
    } else if (
      value.startsWith('98')
    ) {
      value =
        `0${value.substring(2)}`;
    }

    return value;
  }

  private isValidIranMobile(
    phone: string,
  ): boolean {
    return /^09\d{9}$/.test(
      phone,
    );
  }
}
