import { AccountType } from "src/domain/enums/subscription";
import { SubscriptionPlan } from '../../entities/subscription/SubscriptionPlan';

export interface ISubscriptionPlanRepository {
  findById(id: string): Promise<SubscriptionPlan | null>;

  findActiveByAccountType(
    accountType: AccountType,
  ): Promise<SubscriptionPlan[]>;

  save(
    entity: SubscriptionPlan,
  ): Promise<SubscriptionPlan>;
}