import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThanOrEqual, Not, Repository } from 'typeorm';

import { CargoRequest } from '../../../domain/entities/notification/CargoRequest';
import { DriverLocation } from '../../../domain/entities/notification/DriverLocation';
import { DriverLocationLog } from '../../../domain/entities/notification/DriverLocationLog';
import { CargoRequestStatus } from '../../../domain/enums/notification';

const WITH_PARTIES = { listing: true, driver: true } as const;

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

  /** درخواست‌ها/سفرهای بارهای یک شرکت، قدیمی‌ترین اول (اول آمده، اول جواب). */
  findPageForCompany(
    companyUserId: string,
    statuses: CargoRequestStatus[],
    skip: number,
    take: number,
  ): Promise<[CargoRequest[], number]> {
    return this.repository.findAndCount({
      where: { companyUserId, status: In(statuses) },
      relations: WITH_PARTIES,
      order: { createdAt: 'ASC' },
      skip,
      take,
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
