import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { CargoListing } from '../../../domain/entities/notification/CargoListing';
import { cargoCodeMatch } from './cargoCodeMatch';
import { CargoListingStatus, CargoRequestStatus, CargoTripType } from '../../../domain/enums/notification';

/** Where a published load is: still open for drivers, on a driver's trip, or delivered. */
export type ListingStage = 'published' | 'inTransit' | 'delivered';
export const LISTING_STAGES: ListingStage[] = ['published', 'inTransit', 'delivered'];

@Injectable()
export class CargoListingRepository {
  constructor(@InjectRepository(CargoListing) private readonly repository: Repository<CargoListing>) {}

  create(data: Partial<CargoListing>): CargoListing {
    return this.repository.create(data);
  }

  save(listing: CargoListing): Promise<CargoListing> {
    return this.repository.save(listing);
  }

  /** بارهای این ناشر که هنوز یکی از این شماره‌ها یا یکی از این نام‌ها را نشان می‌دهند. */
  findByPublisherContact(publisherUserId: string, phones: string[], companyNames: string[]): Promise<CargoListing[]> {
    const query = this.repository.createQueryBuilder('listing').where('listing.publisherUserId = :publisherUserId', { publisherUserId });
    const matches: string[] = [];
    if (phones.length) matches.push('listing.contactPhones && CAST(:phones AS text[])');
    if (companyNames.length) matches.push('listing.companyName IN (:...companyNames)');
    if (!matches.length) return Promise.resolve([]);
    return query.andWhere(`(${matches.join(' OR ')})`, { phones, companyNames }).getMany();
  }

  /** نام شرکت‌هایی که بار اعلام کرده‌اند؛ آن‌که اخیراً بار داده اول. */
  async findPublisherCompanyNames(limit: number): Promise<string[]> {
    const rows: { name: string }[] = await this.repository
      .createQueryBuilder('listing')
      .select('TRIM(listing.companyName)', 'name')
      .where("listing.companyName IS NOT NULL AND TRIM(listing.companyName) <> ''")
      .groupBy('TRIM(listing.companyName)')
      .orderBy('MAX(listing.createdAt)', 'DESC')
      .limit(limit)
      .getRawMany();
    return rows.map((row) => row.name);
  }

  /**
   * کد پیگیری برای بارهایی که از tarabari_backend نیامده‌اند. sequence از
   * 90000000 شروع می‌شود تا با کدهای tarabari (از 100000) تداخل نداشته باشد.
   */
  async nextManualCode(): Promise<string> {
    const [{ value }] = await this.repository.query(`SELECT nextval('manual_cargo_code_seq') AS value`);
    return `TRB${value}`;
  }

  /** بارهای باز شرکت که هنوز به راننده‌ها اعلام نشده‌اند (صف اعلام خودکار). */
  findPendingAnnounce(publisherUserId: string): Promise<CargoListing[]> {
    return this.repository.find({
      where: { publisherUserId, announcedAt: IsNull(), status: CargoListingStatus.Open },
      order: { createdAt: 'ASC' },
    });
  }

  /** بارهای شرکت که در این بازه به راننده‌ها اعلام شده‌اند (نتیجه‌ی یک نوبت اعلام خودکار). */
  countAnnouncedBetween(publisherUserId: string, from: Date, to: Date): Promise<number> {
    return this.repository.count({ where: { publisherUserId, announcedAt: Between(from, to) } });
  }

  findById(id: string): Promise<CargoListing | null> {
    return this.repository.findOne({ where: { id } });
  }

  findOneForPublisher(id: string, publisherUserId: string): Promise<CargoListing | null> {
    return this.repository.findOne({ where: { id, publisherUserId } });
  }

  /** بار منتشرشده‌ی همین ناشر با این کد (مقایسه با cargoCodeMatch). */
  findByCodeForPublisher(code: string, publisherUserId: string): Promise<CargoListing | null> {
    const match = cargoCodeMatch('listing.code', code);
    return this.repository
      .createQueryBuilder('listing')
      .where('listing.publisherUserId = :publisherUserId', { publisherUserId })
      .andWhere(match.sql, match.params)
      .orderBy('listing.createdAt', 'DESC')
      .getOne();
  }

  /** جدیدترین بار منتشرشده با این کد، از هر شرکتی (راننده با کد بار درخواست می‌دهد). */
  findByCode(code: string): Promise<CargoListing | null> {
    const match = cargoCodeMatch('listing.code', code);
    return this.repository.createQueryBuilder('listing').where(match.sql, match.params).orderBy('listing.createdAt', 'DESC').getOne();
  }

  findBySourceAndPublisher(sourceMessageId: string, publisherUserId: string): Promise<CargoListing | null> {
    return this.repository.findOne({ where: { sourceMessageId, publisherUserId } });
  }

  findManyBySourceAndPublisher(sourceMessageIds: string[], publisherUserId: string): Promise<CargoListing[]> {
    if (sourceMessageIds.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { sourceMessageId: In(sourceMessageIds), publisherUserId } });
  }

  findPageForPublisher(
    publisherUserId: string,
    options: { status?: CargoListingStatus; stage?: ListingStage; skip: number; take: number; announcedOnly?: boolean },
  ): Promise<[CargoListing[], number]> {
    const query = this.repository.createQueryBuilder('listing').where('listing.publisherUserId = :publisherUserId', { publisherUserId });
    if (options.status) query.andWhere('listing.status = :status', { status: options.status });
    if (options.announcedOnly) query.andWhere('listing.announcedAt IS NOT NULL');
    if (options.stage === 'published') query.andWhere('listing.status = :open', { open: CargoListingStatus.Open });
    if (options.stage === 'inTransit' || options.stage === 'delivered') {
      query.andWhere(
        'EXISTS (SELECT 1 FROM "CargoRequest" trip WHERE trip."listingId" = listing.id AND trip.status = :tripStatus)',
        { tripStatus: options.stage === 'inTransit' ? CargoRequestStatus.Accepted : CargoRequestStatus.Delivered },
      );
    }
    return query.orderBy('listing.createdAt', 'DESC').skip(options.skip).take(options.take).getManyAndCount();
  }

  /** بارهای هنوز برداشته‌نشده‌ی همه‌ی شرکت‌ها، جدیدترین اول (برای «پیدا کردن بار» راننده). */
  findOpenPage(options: { skip: number; take: number; tripType?: CargoTripType; tripTypes?: CargoTripType[] }): Promise<[CargoListing[], number]> {
    return this.repository.findAndCount({
      where: { status: CargoListingStatus.Open, announcedAt: Not(IsNull()), ...(options.tripTypes ? { tripType: In(options.tripTypes) } : options.tripType ? { tripType: options.tripType } : {}) },
      order: { createdAt: 'DESC' },
      skip: options.skip,
      take: options.take,
    });
  }

  /**
   * فقط اگر وضعیت واقعاً عوض شود true برمی‌گرداند. شرط روی وضعیت قبلی باعث
   * می‌شود دو کلیک همزمان فقط یک بار پیام‌ها را ویرایش کنند.
   */
  async changeStatus(id: string, status: CargoListingStatus): Promise<boolean> {
    const taken = status === CargoListingStatus.Taken;
    const result = await this.repository.update(
      { id, status: taken ? CargoListingStatus.Open : CargoListingStatus.Taken },
      { status, takenAt: taken ? new Date() : null },
    );

    return (result.affected ?? 0) > 0;
  }
}
