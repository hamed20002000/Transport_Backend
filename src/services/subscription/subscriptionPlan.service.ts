import {
  Inject,
  Injectable,
} from '@nestjs/common';

import { SubscriptionPlan } from 'src/domain/entities/subscription/SubscriptionPlan';

import { AccountType } from 'src/domain/enums/subscription';

import { ISubscriptionPlanRepository } from 'src/domain/repositories/subscription/ISubscriptionPlanRepository';

import {
  SUBSCRIPTION_PLAN_REPOSITORY,
} from 'src/domain/repositories/repository.tokens';

@Injectable()
export class SubscriptionPlanService {
  constructor(
    @Inject(
      SUBSCRIPTION_PLAN_REPOSITORY,
    )
    private readonly subscriptionPlanRepository:
      ISubscriptionPlanRepository,
  ) {}

  async findById(
    id: string,
  ): Promise<SubscriptionPlan | null> {
    return this.subscriptionPlanRepository
      .findById(id);
  }

  async findActiveByAccountType(
    accountType: AccountType,
  ): Promise<SubscriptionPlan[]> {
    return this.subscriptionPlanRepository
      .findActiveByAccountType(
        accountType,
      );
  }
}