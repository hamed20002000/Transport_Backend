import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../auth/User';
import { NotificationDeliveryStatus } from '../../enums/notification';
import { WhatsappMessageKey } from '../../constants/whatsappMessageKey';
import { CargoListing } from './CargoListing';

/**
 * یک اعلان بار برای یک کاربر، از یکی از دو نوع:
 *  - پیشنهاد به شرکت (listingId خالی): «این بار در کانال شما آمد».
 *  - بار منتشرشده برای راننده (listingId پر): شرکتی آن را به نام خودش فرستاده.
 *
 * کلیدهای یکتا جلوی اعلان تکراری را می‌گیرند، چون RabbitMQ ممکن است یک پیام
 * را دوباره تحویل دهد. وضعیت هر کانال جدا نگه داشته می‌شود تا فقط کانال‌هایی
 * که هنوز ارسال نشده‌اند دوباره امتحان شوند.
 */
@Entity('CargoNotification')
@Index('UQ_CargoNotification_message_user', ['sourceMessageId', 'userId'], {
  unique: true,
  where: '"listingId" IS NULL',
})
@Index('UQ_CargoNotification_listing_user', ['listingId', 'userId'], {
  unique: true,
  where: '"listingId" IS NOT NULL',
})
@Index('IDX_CargoNotification_user_read_created', ['userId', 'isRead', 'createdAt'])
@Index('IDX_CargoNotification_createdAt', ['createdAt'])
export class CargoNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_CargoNotification_userId' })
  user!: User;

  // شناسه‌ی پیام بار در tarabari_backend
  @Column({ type: 'varchar', length: 100 })
  sourceMessageId!: string;

  // فقط برای اعلان راننده‌ها: باری که شرکت منتشر کرده.
  @Column({ type: 'uuid', nullable: true })
  listingId?: string | null;

  @ManyToOne(() => CargoListing, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listingId', foreignKeyConstraintName: 'FK_CargoNotification_listingId' })
  listing?: CargoListing | null;

  @Column({ type: 'text' })
  text!: string;

  // کل payload رویداد برای نمایش جزئیات در فرانت
  @Column('jsonb')
  payload!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  isRead!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  readAt?: Date | null;

  @Column({ type: 'enum', enum: NotificationDeliveryStatus, default: NotificationDeliveryStatus.Pending })
  telegramStatus!: NotificationDeliveryStatus;

  @Column({ type: 'enum', enum: NotificationDeliveryStatus, default: NotificationDeliveryStatus.Pending })
  whatsappStatus!: NotificationDeliveryStatus;

  // شناسه‌ی پیام‌های ارسال‌شده، تا وقتی بار برداشته شد همان پیام ویرایش شود.
  @Column({ type: 'varchar', length: 100, nullable: true })
  telegramChatId?: string | null;

  @Column({ type: 'integer', nullable: true })
  telegramMessageId?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  whatsappMessageKey?: WhatsappMessageKey | null;

  // تلاش مجدد ارسال ناموفق: تا وقتی وضعیت PENDING است و nextRetryAt رسیده،
  // CargoDeliveryRetryWorker دوباره امتحان می‌کند.
  @Column({ type: 'integer', default: 0 })
  telegramAttempts!: number;

  @Column({ type: 'timestamp', nullable: true })
  telegramNextRetryAt?: Date | null;

  @Column({ type: 'integer', default: 0 })
  whatsappAttempts!: number;

  @Column({ type: 'timestamp', nullable: true })
  whatsappNextRetryAt?: Date | null;

  // واتساپ فقط تا ۱۵ دقیقه بعد از ارسال اجازه‌ی ویرایش می‌دهد.
  @Column({ type: 'timestamp', nullable: true })
  whatsappSentAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
