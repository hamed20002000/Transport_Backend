import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Subscription } from '../../../domain/entities/subscription/Subscription';
import { SubscriptionStatus } from '../../../domain/enums/subscription';
import { ISubscriptionRepository } from '../../../domain/repositories/subscription/ISubscriptionRepository';

@Injectable()
export class SubscriptionRepository implements ISubscriptionRepository {
  constructor(@InjectRepository(Subscription) private readonly repository: Repository<Subscription>) {}

  findActiveByUserId(userId: string): Promise<Subscription | null> {
    const now = new Date();
    return this.repository.findOne({
      where: { userId, status: SubscriptionStatus.Active, startAt: LessThanOrEqual(now), expireAt: MoreThan(now) },
      order: { expireAt: 'DESC' },
    });
  }

  save(subscription: Subscription): Promise<Subscription> {
    return this.repository.save(subscription);
  }
}
