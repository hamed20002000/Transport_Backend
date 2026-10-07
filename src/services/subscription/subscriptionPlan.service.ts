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


  /**
   * به دست آوردن سابسکریپشن پلن با استفاده از ایدی
   * @param id 
   * @returns 
   */

  //#region -----------------------  به دست آوردن سابسکریپشن با ایدی -------------------------- 
  async findById(
    id: string,
  ): Promise<SubscriptionPlan | null> {
    return this.subscriptionPlanRepository
      .findById(id);
  }
  //#endregion ----------------------------------------------------------------------------------

 /**
  * بررسی اینکه آیا اکانت مورد نظر براش سابسکریپشن تعریف شده یا نه؟
  * @param accountType
  * @returns 
  */
 //#region ---------------------------  آیا برای اکانت ساب تعریف شده یا نه -----------------------
  async findActiveByAccountType(
    accountType: AccountType,
  ): Promise<SubscriptionPlan[]> {
    return this.subscriptionPlanRepository
      .findActiveByAccountType(
        accountType,
      );
  }
  //#endregion -------------------------------------------------------------------------------------
}