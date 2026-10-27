import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { User } from '../../../domain/entities/auth/User';
import { CompanyUser } from '../../../domain/entities/auth/CompanyUser';
import { RecordStatus } from '../../../domain/enums/RecordStatus';
import { CustomerType } from '../../../domain/enums/company.enum';
import { SubscriptionStatus } from '../../../domain/enums/subscription';
import { CargoTripType } from '../../../domain/enums/notification';
import { DRIVER_KIND_TRIP_TYPES, driverKindForLoad } from '../../../services/notification/cargoTripType';

export const DRIVER_ROLE = 'DRIVER';
export const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];

export interface PublisherContact {
  mobile: string | null;
  // id is null when the name/phone come only from the user's profile and no TransportCompany is linked.
  company: {
    id: string | null;
    name: string;
    phone: string | null;
    // the names for domestic and for international (export/import) loads, when the company set them
    domesticName?: string | null;
    internationalName?: string | null;
  } | null;
}

/** کوئری‌هایی که مشخص می‌کنند بار منتشرشده به چه کسانی برسد و از طرف چه کسی. */
@Injectable()
export class CargoAudienceRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * راننده‌های فعال که الان اجازه‌ی کار دارند و با tripType فقط راننده‌های عضو نوع حمل و شرکت منتشرکننده؛
   * بار شرکت مادر (User.isParentCompany) به همه‌ی راننده‌های آن نوع می‌رسد و راننده فقط با فیلتر بار کنارش می‌گذارد.
   * driverRule روشن: فقط آن‌هایی که اشتراک فعال دارند یا هنوز در دوره‌ی رایگانشان هستند
   * (از ثبت‌نام یا شروع قاعده، هر کدام دیرتر؛ همان حساب SubscriptionAccessService).
   */
  async findDriverIds(
    driverRule: { driversEnforced: boolean; driverTrialDays: number; driverTrialStartedAt: string },
    tripType?: CargoTripType,
    publisherUserId?: string,
    now = new Date(),
  ): Promise<string[]> {
    const query = this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .select('DISTINCT user.id', 'id')
      .innerJoin('user.userRoles', 'userRole')
      .innerJoin('userRole.role', 'role', 'role.name = :driver AND role.recordStatus = :active');
    if (driverRule.driversEnforced) {
      query
        .leftJoin(
          'Subscription',
          'subscription',
          'subscription.userId = user.id AND subscription.status = :subscriptionActive ' +
            'AND subscription.startAt <= :now AND subscription.expireAt > :now',
        )
        .andWhere(
          '(subscription.id IS NOT NULL OR GREATEST(user.createdAt, :trialStartedAt) + make_interval(days => :trialDays) > :now ' +
            // free days given as a reward count like a subscription (SubscriptionRewardService)
            'OR EXISTS (SELECT 1 FROM "SubscriptionBonus" bonus WHERE bonus."userId" = user.id AND bonus."startAt" <= :now AND bonus."expireAt" > :now))',
          { trialStartedAt: new Date(driverRule.driverTrialStartedAt), trialDays: driverRule.driverTrialDays },
        );
    }
    if (tripType || publisherUserId) query.innerJoin('DriverProfile', 'profile', 'profile.userId = user.id');
    // an export or import load reaches every international driver (DriverKind), even one saved with only one of them
    if (tripType) query.andWhere('profile.tripTypes && CAST(:driverTripTypes AS varchar[])', { driverTripTypes: DRIVER_KIND_TRIP_TYPES[driverKindForLoad(tripType)] });
    if (publisherUserId && !(await this.isParentCompany(publisherUserId))) {
      query.andWhere('profile.companyUserIds @> ARRAY[:publisherUserId]::uuid[]', { publisherUserId });
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

  /** how this user sees loads (User.cargoDisplay): IMAGE sends a picture of the load before its message */
  async cargoDisplayOf(userId: string): Promise<'TEXT' | 'IMAGE'> {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId }, select: { id: true, cargoDisplay: true } });
    return user?.cargoDisplay === 'IMAGE' ? 'IMAGE' : 'TEXT';
  }

  async isParentCompany(userId: string): Promise<boolean> {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId }, select: { id: true, isParentCompany: true } });
    return !!user?.isParentCompany;
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

  /**
   * موبایل ثبت‌نام کاربر و شرکت حمل‌ونقلی که به آن وصل است (اگر باشد).
   * profile: فیلدهای پروفایل به‌جای مقدار فعلی (مخاطب پیش از تغییر پروفایل، ProfileContactChangedEvent).
   */
  async findPublisherContact(
    userId: string,
    profile?: Partial<Pick<User, 'profileType' | 'firstName' | 'lastName' | 'companyName' | 'phone' | 'domesticCompanyName' | 'internationalCompanyName'>>,
  ): Promise<PublisherContact> {
    const stored = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    const user = stored && profile ? { ...stored, ...profile } : stored;

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
      company: name || company
        ? {
            id: company?.id ?? null,
            name: name ?? '',
            phone,
            domesticName: user?.domesticCompanyName?.trim() || null,
            internationalName: user?.internationalCompanyName?.trim() || null,
          }
        : null,
    };
  }
}
