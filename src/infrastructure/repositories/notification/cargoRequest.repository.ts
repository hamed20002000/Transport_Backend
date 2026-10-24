import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThanOrEqual, Not, Repository, type SelectQueryBuilder } from 'typeorm';

import { CargoRequest } from '../../../domain/entities/notification/CargoRequest';
import { DriverLocation } from '../../../domain/entities/notification/DriverLocation';
import { DriverLocationLog } from '../../../domain/entities/notification/DriverLocationLog';
import { CargoRequestStatus, CargoTripType } from '../../../domain/enums/notification';

const WITH_PARTIES = { listing: true, driver: true } as const;

/** Filters of the driver's past trips (delivered loads). */
export interface DriverHistoryFilters {
  // code, origin, destination or company name
  q?: string;
  tripType?: CargoTripType;
  companyUserId?: string;
  // delivered on or after
  since?: Date;
  order?: 'newest' | 'oldest';
}

@Injectable()
export class CargoRequestRepository {
  constructor(@InjectRepository(CargoRequest) private readonly repository: Repository<CargoRequest>) {}

  create(data: Partial<CargoRequest>): CargoRequest {
    return this.repository.create(data);
  }

  save(request: CargoRequest): Promise<CargoRequest> {
    return this.repository.save(request);
  }

  findById(id: string): Promise<CargoRequest | null> {
    return this.repository.findOne({ where: { id }, relations: WITH_PARTIES });
  }

  findByListingAndDriver(listingId: string, driverUserId: string): Promise<CargoRequest | null> {
    return this.repository.findOne({ where: { listingId, driverUserId } });
  }

  /** درخواست‌های راننده، جدیدترین اول. */
  findPageForDriver(
    driverUserId: string,
    statuses: CargoRequestStatus[],
    skip: number,
    take: number,
  ): Promise<[CargoRequest[], number]> {
    return this.repository.findAndCount({
      where: { driverUserId, status: In(statuses) },
      relations: WITH_PARTIES,
      order: { updatedAt: 'DESC' },
      skip,
      take,
    });
  }

  /** سفرهای رفته‌ی راننده (بارهای تحویل‌شده) با فیلترها. */
  findDeliveredForDriver(driverUserId: string, filters: DriverHistoryFilters, skip: number, take: number): Promise<[CargoRequest[], number]> {
    return this.deliveredQuery(driverUserId, filters)
      .leftJoinAndSelect('request.driver', 'driver')
      .orderBy('request.deliveredAt', filters.order === 'oldest' ? 'ASC' : 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();
  }

  /** شمار سفرهای رفته به تفکیک نوع حمل، با همان فیلترها جز خود نوع حمل. */
  async countDeliveredByTripType(driverUserId: string, filters: DriverHistoryFilters): Promise<Record<CargoTripType, number>> {
    const rows = await this.deliveredQuery(driverUserId, { ...filters, tripType: undefined })
      .select('listing.tripType', 'tripType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('listing.tripType')
      .getRawMany<{ tripType: CargoTripType; count: string }>();
    const counts = Object.fromEntries(Object.values(CargoTripType).map((type) => [type, 0])) as Record<CargoTripType, number>;
    for (const row of rows) counts[row.tripType] = Number(row.count);
    return counts;
  }

  /** شرکت‌هایی که راننده برایشان بار برده، برای فیلتر شرکت. */
  async deliveredCompanies(driverUserId: string): Promise<{ id: string; name: string | null; trips: number }[]> {
    const rows = await this.deliveredQuery(driverUserId, {})
      .select('request.companyUserId', 'id')
      .addSelect('MAX(listing.companyName)', 'name')
      .addSelect('COUNT(*)', 'trips')
      .groupBy('request.companyUserId')
      .orderBy('trips', 'DESC')
      .getRawMany<{ id: string; name: string | null; trips: string }>();
    return rows.map((row) => ({ id: row.id, name: row.name, trips: Number(row.trips) }));
  }

  private deliveredQuery(driverUserId: string, filters: DriverHistoryFilters): SelectQueryBuilder<CargoRequest> {
    const query = this.repository
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.listing', 'listing')
      .where('request.driverUserId = :driverUserId', { driverUserId })
      .andWhere('request.status = :status', { status: CargoRequestStatus.Delivered });
    if (filters.tripType) query.andWhere('listing.tripType = :tripType', { tripType: filters.tripType });
    if (filters.companyUserId) query.andWhere('request.companyUserId = :companyUserId', { companyUserId: filters.companyUserId });
    if (filters.since) query.andWhere('request.deliveredAt >= :since', { since: filters.since });
    const q = filters.q?.trim();
    if (q) {
      query.andWhere(
        '(listing.code ILIKE :q OR listing.origin ILIKE :q OR listing.destination ILIKE :q OR listing.companyName ILIKE :q)',
        { q: `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` },
      );
    }
    return query;
  }

  /** درخواست‌های راننده برای چند بار (وضعیت «درخواست من» روی کارت بارها). */
  findForDriverByListings(driverUserId: string, listingIds: string[]): Promise<CargoRequest[]> {
    if (listingIds.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { driverUserId, listingId: In(listingIds) } });
  }

  /** درخواست‌ها/سفرهای بارهای یک شرکت، قدیمی‌ترین اول (اول آمده، اول جواب). */
  /** order: requested = قدیمی‌ترین درخواست اول (صف بررسی)، started = جدیدترین سفر اول. */
  findPageForCompany(
    companyUserId: string,
    statuses: CargoRequestStatus[],
    skip: number,
    take: number,
    order: 'requested' | 'started' = 'requested',
  ): Promise<[CargoRequest[], number]> {
    return this.repository.findAndCount({
      where: { companyUserId, status: In(statuses) },
      relations: WITH_PARTIES,
      order: order === 'started' ? { decidedAt: 'DESC', createdAt: 'DESC' } : { createdAt: 'ASC' },
      skip,
      take,
    });
  }

  /** بار سفر فعال دارد (یا به راننده‌ای سپرده شده که هنوز در مهلت تأیید است)؟ چنین باری دوباره باز نمی‌شود. */
  async hasActiveTrip(listingId: string, now = new Date()): Promise<boolean> {
    const count = await this.repository.count({
      where: [
        { listingId, status: CargoRequestStatus.Accepted },
        { listingId, status: CargoRequestStatus.Offered, offerExpiresAt: MoreThanOrEqual(now) },
      ],
    });
    return count > 0;
  }

  /** درخواست‌های در انتظار بارهای یک شرکت (شمارنده‌ی پنل وب). */
  countPendingForCompany(companyUserId: string): Promise<number> {
    return this.repository.count({ where: { companyUserId, status: CargoRequestStatus.Pending } });
  }

  /** تعداد درخواست‌های در انتظار هر بار (برای کارت‌های «بارهای من»). */
  async countPendingByListings(listingIds: string[]): Promise<Map<string, number>> {
    if (!listingIds.length) return new Map();
    const rows: Array<{ listingId: string; count: string }> = await this.repository
      .createQueryBuilder('request')
      .select('request.listingId', 'listingId')
      .addSelect('COUNT(*)', 'count')
      .where('request.listingId IN (:...listingIds) AND request.status = :pending', { listingIds, pending: CargoRequestStatus.Pending })
      .groupBy('request.listingId')
      .getRawMany();
    return new Map(rows.map((row) => [row.listingId, Number(row.count)]));
  }

  /** بار تحویل داده شده است؟ چنین باری دیگر باز نمی‌شود. */
  async hasDelivered(listingId: string): Promise<boolean> {
    return (await this.repository.count({ where: { listingId, status: CargoRequestStatus.Delivered } })) > 0;
  }

  /** سفرهای فعال شرکت که پیش از before شروع شده‌اند و تحویلشان ثبت نشده. */
  countTripsStartedBefore(companyUserId: string, before: Date): Promise<number> {
    return this.repository
      .createQueryBuilder('request')
      .where('request.companyUserId = :companyUserId AND request.status = :status', { companyUserId, status: CargoRequestStatus.Accepted })
      .andWhere('COALESCE(request.decidedAt, request.updatedAt) < :before', { before })
      .getCount();
  }

  /** سفرهای فعالی که از شروع (یا آخرین یادآوری) تا before تحویلشان ثبت نشده. */
  findTripsDueDeliveryReminder(before: Date): Promise<CargoRequest[]> {
    return this.repository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.listing', 'listing')
      .leftJoinAndSelect('request.driver', 'driver')
      .where('request.status = :status', { status: CargoRequestStatus.Accepted })
      .andWhere('COALESCE(request.deliveryRemindedAt, request.decidedAt, request.updatedAt) < :before', { before })
      .getMany();
  }

  /** راننده‌ای که شرکت این بار را به او سپرده و هنوز در مهلت تأیید است. */
  findActiveOffer(listingId: string): Promise<CargoRequest | null> {
    return this.repository.findOne({
      where: { listingId, status: CargoRequestStatus.Offered, offerExpiresAt: MoreThanOrEqual(new Date()) },
      relations: WITH_PARTIES,
    });
  }

  /** پیشنهادهای در مهلت برای چند بار (نشان «رزرو شده» روی کارت بارها). */
  findActiveOffersForListings(listingIds: string[]): Promise<CargoRequest[]> {
    if (listingIds.length === 0) return Promise.resolve([]);
    return this.repository.find({
      where: { listingId: In(listingIds), status: CargoRequestStatus.Offered, offerExpiresAt: MoreThanOrEqual(new Date()) },
    });
  }

  /** پیشنهادهایی که مهلت تأییدشان گذشته. */
  findExpiredOffers(now: Date, take = 100): Promise<CargoRequest[]> {
    return this.repository.find({
      where: { status: CargoRequestStatus.Offered, offerExpiresAt: LessThan(now) },
      relations: WITH_PARTIES,
      take,
    });
  }

  /** درخواست‌های در انتظار یک بار، قدیمی‌ترین اول (اول آمده، اول در لیست). */
  findPendingForListing(listingId: string): Promise<CargoRequest[]> {
    return this.repository.find({ where: { listingId, status: CargoRequestStatus.Pending }, order: { createdAt: 'ASC' } });
  }

  /** راننده‌ی هر بار (سپرده‌شده، در سفر یا تحویل‌شده) برای کارت «بارهای من» شرکت. */
  findAssignmentsForListings(listingIds: string[]): Promise<CargoRequest[]> {
    if (listingIds.length === 0) return Promise.resolve([]);
    return this.repository.find({
      where: {
        listingId: In(listingIds),
        status: In([CargoRequestStatus.Offered, CargoRequestStatus.Accepted, CargoRequestStatus.Delivered]),
      },
      order: { updatedAt: 'DESC' },
    });
  }

  /** بقیه‌ی درخواست‌های در انتظار همین بار (وقتی یکی قبول شد). */
  findOtherPending(listingId: string, exceptId: string): Promise<CargoRequest[]> {
    return this.repository.find({
      where: { listingId, status: CargoRequestStatus.Pending, id: Not(exceptId) },
      relations: WITH_PARTIES,
    });
  }

  /** آخرین سفر راننده (فعال یا تحویل‌شده) برای پیشنهاد بار برگشتی از مقصدش. */
  findLatestTrip(driverUserId: string): Promise<CargoRequest | null> {
    return this.repository.findOne({
      where: { driverUserId, status: In([CargoRequestStatus.Accepted, CargoRequestStatus.Delivered]) },
      relations: WITH_PARTIES,
      order: { decidedAt: 'DESC' },
    });
  }
}

@Injectable()
export class DriverLocationRepository {
  constructor(
    @InjectRepository(DriverLocation) private readonly repository: Repository<DriverLocation>,
    @InjectRepository(DriverLocationLog) private readonly logs: Repository<DriverLocationLog>,
  ) {}

  find(userId: string): Promise<DriverLocation | null> {
    return this.repository.findOne({ where: { userId } });
  }

  async upsert(location: Pick<DriverLocation, 'userId' | 'latitude' | 'longitude' | 'liveUntil' | 'receivedAt'>): Promise<void> {
    // updatedAt خودکار فقط در save به‌روز می‌شود؛ در upsert صریح می‌دهیم.
    await this.repository.upsert({ ...location, updatedAt: location.receivedAt }, ['userId']);
  }

  latestLog(userId: string): Promise<DriverLocationLog | null> {
    return this.logs.findOne({ where: { userId }, order: { receivedAt: 'DESC' } });
  }

  async addLog(log: Pick<DriverLocationLog, 'userId' | 'latitude' | 'longitude' | 'live' | 'receivedAt'>): Promise<void> {
    await this.logs.insert(log);
  }

  /** موقعیت‌های بعد از یک زمان، قدیمی اول (برای کشیدن مسیر طی‌شده). */
  history(userId: string, since: Date, limit: number): Promise<DriverLocationLog[]> {
    return this.logs
      .find({ where: { userId, receivedAt: MoreThanOrEqual(since) }, order: { receivedAt: 'DESC' }, take: limit })
      .then((rows) => rows.reverse());
  }

  async pruneLogs(userId: string, before: Date): Promise<void> {
    await this.logs.delete({ userId, receivedAt: LessThan(before) });
  }
}
