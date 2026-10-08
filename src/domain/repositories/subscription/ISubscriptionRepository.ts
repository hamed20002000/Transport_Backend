import { Subscription } from '../../entities/subscription/Subscription';

export interface ISubscriptionRepository {
  /**
 * بررسی اینکه آیا کاربر سابسکریپشن فعال دارد یا نه
 * @param userId
 * @returns 
 */
  findActiveByUserId(
    userId: string,
  ): Promise<Subscription | null>;

   /**
   * سابسکریپشن کاربر به همراه اطلاعات خود سابسکریپشن بر میگردونه
   * هم رکورد ازsubscription و هم subscriptionplan  با استفاده از SubscriptionPlanId
   * @param userId 
   * @returns 
   */
  findActiveWithPlanByUserId(
    userId: string,
  ): Promise<Subscription | null>;

    /**
   * ذخیره سابسکریپشن جدید برای کاربر در جدول Subscription
   * @param subscription 
   * @returns 
   */
  save(
    entity: Subscription,
  ): Promise<Subscription>;
}