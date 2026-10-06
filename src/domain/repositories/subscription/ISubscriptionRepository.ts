import { Subscription } from '../../entities/subscription/Subscription';

export interface ISubscriptionRepository {
  findActiveByUserId(
    userId: string,
  ): Promise<Subscription | null>;

  /** مثل findActiveByUserId به‌همراه پلن (عنوان و نوع حساب). */
  findActiveWithPlanByUserId(
    userId: string,
  ): Promise<Subscription | null>;

  save(
    entity: Subscription,
  ): Promise<Subscription>;
}