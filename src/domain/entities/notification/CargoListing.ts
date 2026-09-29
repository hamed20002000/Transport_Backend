import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../auth/User';
import { TransportCompany } from '../company/TransportCompany';
import { CargoListingStatus } from '../../enums/notification';

/**
 * باری که یک شرکت به نام خودش برای راننده‌ها منتشر کرده است.
 *
 * بار دیده‌شده در کانال تا وقتی شرکت آن را منتشر نکند اینجا ثبت نمی‌شود.
 * هر شرکت نسخه‌ی خودش را دارد (با شماره‌ی تماس خودش)، پس اگر دو شرکت یک بار
 * را منتشر کنند دو ردیف جدا ساخته می‌شود.
 */
@Entity('CargoListing')
@Index('UQ_CargoListing_source_publisher', ['sourceMessageId', 'publisherUserId'], { unique: true })
@Index('IDX_CargoListing_publisher_created', ['publisherUserId', 'createdAt'])
@Index('IDX_CargoListing_code', ['code'])
export class CargoListing {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // شناسه‌ی پیام بار در tarabari_backend
  @Column({ type: 'varchar', length: 100 })
  sourceMessageId!: string;

  // کد پیگیری (TRB...): همان کد بار در tarabari_backend، یا برای بار دستی از
  // manual_cargo_code_seq. یکتا نیست: اگر دو شرکت یک بار را منتشر کنند کدشان یکی است.
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  // اعلان پیشنهادی که شرکت از رویش منتشر کرد
  @Column({ type: 'uuid', nullable: true })
  sourceNotificationId?: string | null;

  @Column({ type: 'uuid' })
  publisherUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publisherUserId', foreignKeyConstraintName: 'FK_CargoListing_publisherUserId' })
  publisher!: User;

  @Column({ type: 'uuid', nullable: true })
  companyId?: string | null;

  @ManyToOne(() => TransportCompany, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'companyId', foreignKeyConstraintName: 'FK_CargoListing_companyId' })
  company?: TransportCompany | null;

  // فیلدهایی که شرکت تأیید/ویرایش کرده؛ متن پیام راننده‌ها از همین‌ها ساخته می‌شود.
  @Column({ type: 'varchar', length: 200, nullable: true })
  companyName?: string | null;

  @Column({ type: 'varchar', length: 200 })
  origin!: string;

  @Column({ type: 'varchar', length: 200 })
  destination!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  cargoType?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  weight?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  vehicleType?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  price?: string | null;

  @Column({ type: 'text', nullable: true })
  extraNotes?: string | null;

  @Column('text', { array: true, default: () => "'{}'" })
  contactPhones!: string[];

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'enum', enum: CargoListingStatus, default: CargoListingStatus.Open })
  status!: CargoListingStatus;

  @Column({ type: 'timestamp', nullable: true })
  takenAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
