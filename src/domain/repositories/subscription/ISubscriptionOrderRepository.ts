import { SubscriptionOrder } from '../../entities/subscription/SubscriptionOrder';

export interface ISubscriptionOrderRepository {
  findById(
    id: string,
  ): Promise<SubscriptionOrder | null>;

  findByIdWithPlan(
    id: string,
  ): Promise<SubscriptionOrder | null>;

  findPendingByProviderUser(
    provider: string,
    providerUserId: string,
  ): Promise<SubscriptionOrder | null>;

  save(
    entity: SubscriptionOrder,
  ): Promise<SubscriptionOrder>;
}