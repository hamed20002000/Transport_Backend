import { SubscriptionOrder } from '../../entities/subscription/SubscriptionOrder';
import { CommunicationProvider } from '../../enums/subscription';

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

  findLatestByProviderUser(
    provider: CommunicationProvider,
    providerUserId: string,
  ): Promise<SubscriptionOrder | null>;

  /** آخرین خرید کاربر از هر رباتی که به حسابش وصل است (با پلن و رسیدها). */
  findLatestByUserId(
    userId: string,
  ): Promise<SubscriptionOrder | null>;

  save(
    entity: SubscriptionOrder,
  ): Promise<SubscriptionOrder>;
}
