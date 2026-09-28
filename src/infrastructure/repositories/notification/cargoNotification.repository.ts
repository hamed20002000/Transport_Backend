import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, LessThanOrEqual, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CargoNotification } from '../../../domain/entities/notification/CargoNotification';
import { NotificationDeliveryStatus } from '../../../domain/enums/notification';

/** suggestion = پیشنهاد بار به شرکت، listing = بار منتشرشده برای راننده */
export type CargoNotificationKind = 'suggestion' | 'listing';

export type CargoNotificationDelivery = Partial<
  Pick<
    CargoNotification,
    | 'telegramStatus' | 'telegramChatId' | 'telegramMessageId' | 'telegramAttempts' | 'telegramNextRetryAt'
    | 'whatsappStatus' | 'whatsappMessageKey' | 'whatsappSentAt' | 'whatsappAttempts' | 'whatsappNextRetryAt'
  >
>;

export type NewCargoNotification = Pick<CargoNotification, 'userId' | 'sourceMessageId' | 'text' | 'payload'> &
  Partial<Pick<CargoNotification, 'listingId' | 'telegramNextRetryAt' | 'whatsappNextRetryAt'>>;

@Injectable()
export class CargoNotificationRepository {
  constructor(@InjectRepository(CargoNotification) private readonly repository: Repository<CargoNotification>) {}

  /**
   * ردیف‌هایی که از قبل وجود دارند (تحویل مجدد همان پیام) نادیده گرفته می‌شوند.
   * فقط شناسه‌ی ردیف‌هایی که واقعاً ساخته شدند برگردانده می‌شود.
   */
  async insertIgnoringDuplicates(rows: NewCargoNotification[]): Promise<Set<string>> {
    if (rows.length === 0) return new Set();

    const result = await this.repository
      .createQueryBuilder()
      .insert()
      .into(CargoNotification)
      .values(rows as QueryDeepPartialEntity<CargoNotification>[])
      .orIgnore()
      .returning(['id'])
      .execute();

    return new Set((result.raw as { id: string }[]).map((row) => row.id));
  }

  /** اعلان‌های پیشنهادی (به شرکت‌ها) یک پیام بار. */
  findSuggestions(sourceMessageId: string, userIds: string[]): Promise<CargoNotification[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { sourceMessageId, userId: In(userIds), listingId: IsNull() } });
  }

  /** اعلان‌های راننده‌ها برای یک بار منتشرشده. */
  findByListing(listingId: string): Promise<CargoNotification[]> {
    return this.repository.find({ where: { listingId }, relations: { listing: true } });
  }

  findOneForUser(id: string, userId: string): Promise<CargoNotification | null> {
    return this.repository.findOne({ where: { id, userId }, relations: { listing: true } });
  }

  async updateDelivery(id: string, changes: CargoNotificationDelivery): Promise<void> {
    await this.repository.update({ id }, changes as QueryDeepPartialEntity<CargoNotification>);
  }

  /** اعلان‌هایی که حداقل یک کانالشان زمان تلاش مجددش رسیده است. */
  findDueRetries(now: Date, createdAfter: Date, take: number): Promise<CargoNotification[]> {
    const recent = MoreThanOrEqual(createdAfter);
    return this.repository.find({
      where: [
        { telegramStatus: NotificationDeliveryStatus.Pending, telegramNextRetryAt: LessThanOrEqual(now), createdAt: recent },
        { whatsappStatus: NotificationDeliveryStatus.Pending, whatsappNextRetryAt: LessThanOrEqual(now), createdAt: recent },
      ],
      relations: { listing: true },
      order: { createdAt: 'ASC' },
      take,
    });
  }

  /** کانال‌هایی که بعد از پایان مهلت هنوز ارسال نشده‌اند، نهایتاً ناموفق می‌شوند. */
  async failExpiredPending(createdBefore: Date): Promise<number> {
    const old = LessThan(createdBefore);
    const pending = NotificationDeliveryStatus.Pending;
    const failed = NotificationDeliveryStatus.Failed;

    const telegram = await this.repository.update(
      { telegramStatus: pending, createdAt: old },
      { telegramStatus: failed, telegramNextRetryAt: null },
    );
    const whatsapp = await this.repository.update(
      { whatsappStatus: pending, createdAt: old },
      { whatsappStatus: failed, whatsappNextRetryAt: null },
    );

    return (telegram.affected ?? 0) + (whatsapp.affected ?? 0);
  }

  findPageForUser(
    userId: string,
    options: { unreadOnly: boolean; kind?: CargoNotificationKind; skip: number; take: number },
  ): Promise<[CargoNotification[], number]> {
    const kind = options.kind === 'suggestion' ? { listingId: IsNull() } : options.kind === 'listing' ? { listingId: Not(IsNull()) } : {};
    return this.repository.findAndCount({
      where: {
        userId,
        ...(options.unreadOnly ? { isRead: false } : {}),
        ...kind,
      },
      relations: { listing: true },
      order: { createdAt: 'DESC' },
      skip: options.skip,
      take: options.take,
    });
  }

  countUnread(userId: string): Promise<number> {
    return this.repository.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: string, id?: string): Promise<number> {
    const result = await this.repository.update(
      { userId, isRead: false, ...(id ? { id } : {}) },
      { isRead: true, readAt: new Date() },
    );
    return result.affected ?? 0;
  }
}
