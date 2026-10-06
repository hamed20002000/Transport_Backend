import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SubscriptionOrder } from '../../../domain/entities/subscription/SubscriptionOrder';
import { CommunicationProvider } from '../../../domain/enums/subscription';

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

  async findLatestByUserId(
    userId: string,
  ): Promise<SubscriptionOrder | null> {
    return this.repository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.subscriptionPlan', 'plan')
      .leftJoinAndSelect('order.receipts', 'receipt')
      // سفارش با شناسه‌ی پیام‌رسان ثبت می‌شود؛ اتصال‌های BotLink آن را به کاربر می‌رسانند.
      .where(
        'order.providerUserId IN (SELECT link."externalUserId" FROM "BotLink" link WHERE link."userId" = :userId)',
        { userId },
      )
      .orWhere('order.createdUserId = :userId', { userId })
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('receipt.createdAt', 'DESC')
      .getOne();
  }

  async findLatestByProviderUser(
    provider: CommunicationProvider,
    providerUserId: string,
  ): Promise<SubscriptionOrder | null> {
    return this.repository.findOne({
      where: { provider, providerUserId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async save(
    entity: SubscriptionOrder,
  ): Promise<SubscriptionOrder> {
    return this.repository.save(entity);
  }
}
