import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { User } from '../../../domain/entities/auth/User';
import { CompanyUser } from '../../../domain/entities/auth/CompanyUser';
import { RecordStatus } from '../../../domain/enums/RecordStatus';
import { SubscriptionStatus } from '../../../domain/enums/subscription';

export const DRIVER_ROLE = 'DRIVER';

export interface PublisherContact {
  mobile: string | null;
  company: { id: string; name: string; phone: string | null } | null;
}

/** کوئری‌هایی که مشخص می‌کنند بار منتشرشده به چه کسانی برسد و از طرف چه کسی. */
@Injectable()
export class CargoAudienceRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** راننده‌های فعال با اشتراک فعال. */
  async findSubscribedDriverIds(now = new Date()): Promise<string[]> {
    const rows = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .select('DISTINCT user.id', 'id')
      .innerJoin('user.userRoles', 'userRole')
      .innerJoin('userRole.role', 'role', 'role.name = :driver AND role.recordStatus = :active')
      .innerJoin(
        'Subscription',
        'subscription',
        'subscription.userId = user.id AND subscription.status = :subscriptionActive ' +
          'AND subscription.startAt <= :now AND subscription.expireAt > :now',
      )
      .where('user.recordStatus = :active')
      .setParameters({
        driver: DRIVER_ROLE,
        active: RecordStatus.Active,
        subscriptionActive: SubscriptionStatus.Active,
        now,
      })
      .getRawMany<{ id: string }>();

    return rows.map((row) => row.id);
  }

  /** موبایل ثبت‌نام کاربر و شرکت حمل‌ونقلی که به آن وصل است (اگر باشد). */
  async findPublisherContact(userId: string): Promise<PublisherContact> {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });

    const companyUser = await this.dataSource.getRepository(CompanyUser).findOne({
      where: { userId, recordStatus: RecordStatus.Active },
      relations: { transportCompany: true },
      order: { createdAt: 'ASC' },
    });
    const company = companyUser?.transportCompany;

    return {
      mobile: user?.mobile ?? null,
      company: company ? { id: company.id, name: company.name, phone: company.phone ?? null } : null,
    };
  }
}
