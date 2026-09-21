import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionOrder } from '../../../domain/entities/subscription/SubscriptionOrder';

import { ISubscriptionOrderRepository } from '../../../domain/repositories/subscription/ISubscriptionOrderRepository';

@Injectable()
export class SubscriptionOrderRepository
  implements ISubscriptionOrderRepository
{
  constructor(
    @InjectRepository(SubscriptionOrder)
    private readonly repository: Repository<SubscriptionOrder>,
  ) {}

  async findById(
    id: string,
  ): Promise<SubscriptionOrder | null> {
    return this.repository.findOne({
      where: {
        id,
      },
    });
  }

  async findByIdWithPlan(
    id: string,
  ): Promise<SubscriptionOrder | null> {
    return this.repository.findOne({
      where: {
        id,
      },
      relations: {
        subscriptionPlan: true,
      },
    });
  }

  async findPendingByProviderUser(
    provider: string,
    providerUserId: string,
  ): Promise<SubscriptionOrder | null> {
    return this.repository
      .createQueryBuilder('order')
      .where('order.provider = :provider', {
        provider,
      })
      .andWhere(
        'order.providerUserId = :providerUserId',
        {
          providerUserId,
        },
      )
      .andWhere(
        'order.status NOT IN (:...finalStatuses)',
        {
          finalStatuses: [
            'APPROVED',
            'REJECTED',
            'CANCELLED',
          ],
        },
      )
      .orderBy('order.createdAt', 'DESC')
      .getOne();
  }

  async save(
    entity: SubscriptionOrder,
  ): Promise<SubscriptionOrder> {
    return this.repository.save(entity);
  }
}