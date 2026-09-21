import { Subscription } from '../../entities/subscription/Subscription';

export interface ISubscriptionRepository {
  findActiveByUserId(
    userId: string,
  ): Promise<Subscription | null>;

  save(
    entity: Subscription,
  ): Promise<Subscription>;
}