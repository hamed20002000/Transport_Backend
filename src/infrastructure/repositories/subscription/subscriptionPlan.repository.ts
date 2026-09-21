import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionPlan } from '../../../domain/entities/subscription/SubscriptionPlan';
import { AccountType } from 'src/domain/enums/subscription';
import { RecordStatus } from '../../../domain/enums/RecordStatus';
import { ISubscriptionPlanRepository } from '../../../domain/repositories/subscription/ISubscriptionPlanRepository';

@Injectable()
export class SubscriptionPlanRepository
  implements ISubscriptionPlanRepository
{
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly repository: Repository<SubscriptionPlan>,
  ) {}

  async findById(
    id: string,
  ): Promise<SubscriptionPlan | null> {
    return this.repository.findOne({
      where: {
        id,
      },
    });
  }

  async findActiveByAccountType(
    accountType: AccountType,
  ): Promise<SubscriptionPlan[]> {
    return this.repository.find({
      where: {
        accountType,
        recordStatus: RecordStatus.Active,
      },
      order: {
        sortOrder: 'ASC',
        durationDays: 'ASC',
      },
    });
  }

  async save(
    entity: SubscriptionPlan,
  ): Promise<SubscriptionPlan> {
    return this.repository.save(entity);
  }
}