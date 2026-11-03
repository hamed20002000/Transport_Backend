import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, LessThanOrEqual, MoreThanOrEqual, Not, Raw, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { CargoNotification } from '../../../domain/entities/notification/CargoNotification';
import { cargoCodeMatch } from './cargoCodeMatch';
import { NotificationDeliveryStatus } from '../../../domain/enums/notification';

/** suggestion = پیشنهاد بار به شرکت، listing = بار منتشرشده برای راننده */
export type CargoNotificationKind = 'suggestion' | 'listing';

export type CargoNotificationDelivery = Partial<
  Pick<
    CargoNotification,
    | 'telegramStatus' | 'telegramChatId' | 'telegramMessageId' | 'telegramAttempts' | 'telegramNextRetryAt'
    | 'baleStatus' | 'baleChatId' | 'baleMessageId' | 'baleAttempts' | 'baleNextRetryAt'
    | 'rubikaStatus' | 'rubikaChatId' | 'rubikaMessageId' | 'rubikaAttempts' | 'rubikaNextRetryAt'
    | 'eitaaStatus' | 'eitaaChatId' | 'eitaaMessageId' | 'eitaaAttempts' | 'eitaaNextRetryAt'
    | 'whatsappStatus' | 'whatsappMessageKey' | 'whatsappSentAt' | 'whatsappAttempts' | 'whatsappNextRetryAt'
  >
>;

export type NewCargoNotification = Pick<CargoNotification, 'userId' | 'sourceMessageId' | 'text' | 'payload'> &
  Partial<
    Pick<CargoNotification, 'listingId' | 'telegramNextRetryAt' | 'baleNextRetryAt' | 'rubikaNextRetryAt' | 'eitaaNextRetryAt' | 'whatsappNextRetryAt' | 'telegramStatus' | 'baleStatus' | 'rubikaStatus' | 'eitaaStatus' | 'whatsappStatus'>
  >;

const INSERT_BATCH = 1000;

@Injectable()
export class CargoNotificationRepository {
  constructor(@InjectRepository(CargoNotification) private readonly repository: Repository<CargoNotification>) {}

  /**
   * ردیف‌هایی که از قبل وجود دارند (تحویل مجدد همان پیام) نادیده گرفته می‌شوند.
   * فقط شناسه‌ی ردیف‌هایی که واقعاً ساخته شدند برگردانده می‌شود.
   */
  async insertIgnoringDuplicates(rows: NewCargoNotification[]): Promise<Set<string>> {
    const inserted = new Set<string>();
    // a batch at a time: one INSERT takes at most 65535 values, a few thousand drivers' rows
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const result = await this.repository
        .createQueryBuilder()
        .insert()
        .into(CargoNotification)
        .values(rows.slice(start, start + INSERT_BATCH) as QueryDeepPartialEntity<CargoNotification>[])
        .orIgnore()
        .returning(['id'])
        .execute();
      for (const row of result.raw as { id: string }[]) inserted.add(row.id);
    }
    return inserted;
  }

  /** Notices with their loads (a summary of a driver's loads). */
  findManyWithListing(ids: string[]): Promise<CargoNotification[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.repository.find({ where: { id: In(ids) }, relations: { listing: true }, order: { createdAt: 'ASC' } });
  }

  /** The notices one messenger message carries: one load, or several in a summary. */
  findByMessage(messenger: 'telegram' | 'bale' | 'rubika' | 'eitaa' | 'whatsapp', chatId: string, messageId: string): Promise<CargoNotification[]> {
    const query = this.repository.createQueryBuilder('n').leftJoinAndSelect('n.listing', 'listing').orderBy('n.createdAt', 'ASC');
    if (messenger === 'whatsapp') {
      return query.where(`n."whatsappMessageKey" ->> 'remoteJid' = :chatId AND n."whatsappMessageKey" ->> 'id' = :messageId`, { chatId, messageId }).getMany();
    }
    return query.where(`n."${messenger}ChatId" = :chatId AND n."${messenger}MessageId"::text = :messageId`, { chatId, messageId }).getMany();
  }

  /** One notice with its load, as it is now (the delivery queue works on the latest state). */
  findWithListing(id: string): Promise<CargoNotification | null> {
    return this.repository.findOne({ where: { id }, relations: { listing: true } });
  }

  /**
   * The delivery queue could not take these notices (RabbitMQ down): the retry worker sends them instead, through the
   * messengers still pending.
   */
  async scheduleRetry(ids: string[], at: Date): Promise<void> {
    for (let start = 0; start < ids.length; start += INSERT_BATCH) {
      const chunk = ids.slice(start, start + INSERT_BATCH);
      const pending = NotificationDeliveryStatus.Pending;
      await this.repository.query(
        `UPDATE "CargoNotification" SET
           "telegramNextRetryAt" = CASE WHEN "telegramStatus" = $2 THEN $1 END,
           "baleNextRetryAt" = CASE WHEN "baleStatus" = $2 THEN $1 END,
           "rubikaNextRetryAt" = CASE WHEN "rubikaStatus" = $2 THEN $1 END,
           "eitaaNextRetryAt" = CASE WHEN "eitaaStatus" = $2 THEN $1 END,
           "whatsappNextRetryAt" = CASE WHEN "whatsappStatus" = $2 THEN $1 END
         WHERE id = ANY($3::uuid[])`,
        [at, pending, chunk],
      );
    }
  }

  /** اعلان‌های پیشنهادی (به شرکت‌ها) یک پیام بار. */
  findSuggestions(sourceMessageId: string, userIds: string[]): Promise<CargoNotification[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { sourceMessageId, userId: In(userIds), listingId: IsNull() } });
  }

  /** پیشنهادهای بار کانال‌ها برای این شرکت از این زمان به بعد (اعلام خودکار). */
  findSuggestionsSince(userId: string, since: Date): Promise<CargoNotification[]> {
    return this.repository.find({
      where: { userId, listingId: IsNull(), createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'ASC' },
    });
  }

  /** اعلان‌های راننده‌ها برای یک بار منتشرشده. */
  findByListing(listingId: string): Promise<CargoNotification[]> {
    return this.repository.find({ where: { listingId }, relations: { listing: true } });
  }

  /** پیشنهاد (نه بار منتشرشده) همین کاربر که کد بارش در payload این است. */
  findSuggestionByCode(userId: string, code: string): Promise<CargoNotification | null> {
    const match = cargoCodeMatch("notification.payload->>'code'", code);
    return this.repository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.listingId IS NULL')
      .andWhere(match.sql, match.params)
      .orderBy('notification.createdAt', 'DESC')
      .getOne();
  }

  /** A suggestion by its id alone (its picture, CargoImageController; the picture holds no details). */
  findSuggestionById(id: string): Promise<CargoNotification | null> {
    return this.repository.findOne({ where: { id, listingId: IsNull() } });
  }

  findOneForUser(id: string, userId: string): Promise<CargoNotification | null> {
    return this.repository.findOne({ where: { id, userId }, relations: { listing: true } });
  }

  async updateDelivery(id: string, changes: CargoNotificationDelivery): Promise<void> {
    await this.repository.update({ id }, changes as QueryDeepPartialEntity<CargoNotification>);
  }

  /** پیام‌های اعلان پیشنهاد که هنوز در چت شرکت باقی مانده‌اند. */
  findSuggestionNotices(userId: string, platform: 'telegram' | 'bale' | 'rubika' | 'eitaa' | 'whatsapp'): Promise<CargoNotification[]> {
    const messageColumn = platform === 'whatsapp' ? 'whatsappMessageKey' : `${platform}MessageId`;
    return this.repository.createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId })
      .andWhere('notification.listingId IS NULL')
      .andWhere(`notification.${messageColumn} IS NOT NULL`)
      .getMany();
  }

  /** اعلان‌هایی که حداقل یک کانالشان زمان تلاش مجددش رسیده است. */
  findDueRetries(now: Date, createdAfter: Date, take: number): Promise<CargoNotification[]> {
    const recent = MoreThanOrEqual(createdAfter);
    return this.repository.find({
      where: [
        { telegramStatus: NotificationDeliveryStatus.Pending, telegramNextRetryAt: LessThanOrEqual(now), createdAt: recent },
        { baleStatus: NotificationDeliveryStatus.Pending, baleNextRetryAt: LessThanOrEqual(now), createdAt: recent },
        { rubikaStatus: NotificationDeliveryStatus.Pending, rubikaNextRetryAt: LessThanOrEqual(now), createdAt: recent },
        { eitaaStatus: NotificationDeliveryStatus.Pending, eitaaNextRetryAt: LessThanOrEqual(now), createdAt: recent },
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
    const bale = await this.repository.update(
      { baleStatus: pending, createdAt: old },
      { baleStatus: failed, baleNextRetryAt: null },
    );
    const rubika = await this.repository.update(
      { rubikaStatus: pending, createdAt: old },
      { rubikaStatus: failed, rubikaNextRetryAt: null },
    );
    const eitaa = await this.repository.update(
      { eitaaStatus: pending, createdAt: old },
      { eitaaStatus: failed, eitaaNextRetryAt: null },
    );
    const whatsapp = await this.repository.update(
      { whatsappStatus: pending, createdAt: old },
      { whatsappStatus: failed, whatsappNextRetryAt: null },
    );

    return (telegram.affected ?? 0) + (bale.affected ?? 0) + (rubika.affected ?? 0) + (eitaa.affected ?? 0) + (whatsapp.affected ?? 0);
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
        // the company's own unannounced loads (older rows) are not suggestions: they have their own section
        payload: Raw((column) => `COALESCE((${column} ->> 'registeredByCompany')::boolean, false) = false`),
        // a suggestion the company has published is in «بارهای منتشرشده» (or, not yet announced, in its own section)
        ...(options.kind === 'suggestion'
          ? {
              sourceMessageId: Raw(
                (column) => `NOT EXISTS (SELECT 1 FROM "CargoListing" published WHERE published."sourceMessageId" = ${column} AND published."publisherUserId" = :publisherUserId)`,
                { publisherUserId: userId },
              ),
            }
          : {}),
      },
      relations: { listing: true },
      order: { createdAt: 'DESC' },
      skip: options.skip,
      take: options.take,
    });
  }

  /** جدیدترین ردیف‌های کاربر (حداکثر take تا) برای فیلتر کردن در برنامه. */
  findRecentForUser(
    userId: string,
    options: { unreadOnly: boolean; kind?: CargoNotificationKind; take: number },
  ): Promise<CargoNotification[]> {
    return this.findPageForUser(userId, { ...options, skip: 0 }).then(([rows]) => rows);
  }

  /**
   * Deletes, a batch at a time, the drivers' notices no longer needed: of a load taken before takenBefore (its
   * messages are already marked taken), and any created before createdBefore. A company's suggestions stay: they are
   * its inbox. The rows deleted.
   */
  async deleteFinished(takenBefore: Date, createdBefore: Date, batch = 5000): Promise<number> {
    let deleted = 0;
    for (;;) {
      const [rows]: [unknown[], number] = await this.repository.query(
        `DELETE FROM "CargoNotification" WHERE id IN (
           SELECT n.id FROM "CargoNotification" n
             LEFT JOIN "CargoListing" l ON l.id = n."listingId"
            WHERE n."listingId" IS NOT NULL
              AND ((l.status = 'TAKEN' AND l."takenAt" < $1) OR n."createdAt" < $2)
            LIMIT $3)
         RETURNING id`,
        [takenBefore, createdBefore, batch],
      );
      deleted += rows.length;
      if (rows.length < batch) return deleted;
    }
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
