import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Subscription } from '../../../domain/entities/subscription/Subscription';
import { SubscriptionStatus } from '../../../domain/enums/subscription';
import { ISubscriptionRepository } from '../../../domain/repositories/subscription/ISubscriptionRepository';

@Injectable()
export class SubscriptionRepository implements ISubscriptionRepository {
  constructor(@InjectRepository(Subscription) private readonly repository: Repository<Subscription>) {}

  /**
   * بررسی اینکه آیا کاربر سابسکریپشن فعال دارد یا نه
   * @param userId 
   * @returns 
   */

  //#region --------------------- ایا سابسمریپشن فعال دارد؟ ---------------------------
  findActiveByUserId(userId: string): Promise<Subscription | null> {
    const now = new Date();
    return this.repository.findOne({
      where: { userId, status: SubscriptionStatus.Active, startAt: LessThanOrEqual(now), expireAt: MoreThan(now) },
      order: { expireAt: 'DESC' },
    });
  }
  //#endregion ------------------------------------------------------------------------

  /**
   * سابسکریپشن کاربر به همراه اطلاعات خود سابسکریپشن بر میگردونه
   * هم رکورد ازsubscription و هم subscriptionplan  با استفاده از SubscriptionPlanId
   * @param userId 
   * @returns 
   */

  //#region --------------------------- به دست آوردن سابسکریپشن پلن به همرا اطلاعات خود ساب ------------
  findActiveWithPlanByUserId(userId: string): Promise<Subscription | null> {
    const now = new Date();
    return this.repository.findOne({
      where: { userId, status: SubscriptionStatus.Active, startAt: LessThanOrEqual(now), expireAt: MoreThan(now) },
      relations: { subscriptionPlan: true },
      order: { expireAt: 'DESC' },
    });
  }
  //#endregion ----------------------------------------------------------------------------------------

  /**
   * ذخیره سابسکریپشن جدید برای کاربر در جدول Subscription
   * @param subscription 
   * @returns 
   */

  //#region ---------------------------- ثبت سابسکریپشن جدید برای کاربر ---------------------
  save(subscription: Subscription): Promise<Subscription> {
    return this.repository.save(subscription);
  }
  //#endregion --------------------------------------------------------------------------------
}
