import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { User } from '../../../domain/entities/auth/User';
import { CompanyUser } from '../../../domain/entities/auth/CompanyUser';
import { RecordStatus } from '../../../domain/enums/RecordStatus';
import { CustomerType } from '../../../domain/enums/company.enum';
import { SubscriptionStatus } from '../../../domain/enums/subscription';
import { CargoTripType } from '../../../domain/enums/notification';

export const DRIVER_ROLE = 'DRIVER';
export const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];

export interface PublisherContact {
  mobile: string | null;
  // id is null when the name/phone come only from the user's profile and no TransportCompany is linked.
  company: { id: string | null; name: string; phone: string | null } | null;
}

/** کوئری‌هایی که مشخص می‌کنند بار منتشرشده به چه کسانی برسد و از طرف چه کسی. */
@Injectable()
export class CargoAudienceRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * راننده‌های فعال؛ با requireSubscription فقط آن‌هایی که اشتراک فعال دارند و با tripType
   * فقط راننده‌های همان نوع (راننده‌ی بدون پروفایل داخلی حساب می‌شود).
   */
  async findDriverIds(requireSubscription: boolean, tripType?: CargoTripType, now = new Date()): Promise<string[]> {
    const query = this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .select('DISTINCT user.id', 'id')
      .innerJoin('user.userRoles', 'userRole')
      .innerJoin('userRole.role', 'role', 'role.name = :driver AND role.recordStatus = :active');
    if (requireSubscription) {
      query.innerJoin(
        'Subscription',
        'subscription',
        'subscription.userId = user.id AND subscription.status = :subscriptionActive ' +
          'AND subscription.startAt <= :now AND subscription.expireAt > :now',
      );
    }
    if (tripType) {
      query
        .leftJoin('DriverProfile', 'profile', 'profile.userId = user.id')
        .andWhere(`COALESCE(profile.tripType, '${CargoTripType.Domestic}') = :tripType`, { tripType });
    }
    const rows = await query
      .andWhere('user.recordStatus = :active')
      .setParameters({
        driver: DRIVER_ROLE,
        active: RecordStatus.Active,
        subscriptionActive: SubscriptionStatus.Active,
        now,
      })
      .getRawMany<{ id: string }>();

    return rows.map((row) => row.id);
  }

  /** از میان این کاربرها، آن‌هایی که حساب فعال و نقش فعال شرکت دارند. */
  async filterCompanyUserIds(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const rows = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .select('DISTINCT user.id', 'id')
      .innerJoin('user.userRoles', 'userRole')
      .innerJoin('userRole.role', 'role', 'role.name IN (:...companyRoles) AND role.recordStatus = :active')
      .where('user.id IN (:...userIds) AND user.recordStatus = :active')
      .setParameters({ companyRoles: COMPANY_ROLES, userIds, active: RecordStatus.Active })
      .getRawMany<{ id: string }>();
    const companies = new Set(rows.map((row) => row.id));
    return userIds.filter((id) => companies.has(id));
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

    // آنچه کاربر در پروفایلش ثبت کرده بر اطلاعات جدول شرکت مقدم است؛ برای
    // پروفایل «حقیقی» نام و نام خانوادگی به‌جای نام شرکت می‌آید.
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null;
    const name =
      user?.profileType === CustomerType.Person
        ? fullName ?? user?.companyName ?? company?.name
        : user?.companyName ?? company?.name ?? fullName;
    const phone = user?.phone ?? company?.phone ?? null;

    return {
      mobile: user?.mobile ?? null,
      company: name || company ? { id: company?.id ?? null, name: name ?? '', phone } : null,
    };
  }
}
