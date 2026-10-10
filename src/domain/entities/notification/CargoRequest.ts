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

import { CargoRequestStatus } from '../../enums/notification';
import { User } from '../auth/User';
import { CargoListing } from './CargoListing';

/**
 * درخواست راننده برای باری که شرکت اعلام کرده. شرکت قبول یا رد می‌کند؛
 * درخواست قبول‌شده «سفر فعال» راننده است تا وقتی تحویل ثبت شود.
 * هر راننده برای هر بار یک ردیف دارد (درخواست دوباره همان ردیف را باز می‌کند).
 */
@Entity('CargoRequest')
@Index('UQ_CargoRequest_listing_driver', ['listingId', 'driverUserId'], { unique: true })
@Index('IDX_CargoRequest_driver_status', ['driverUserId', 'status'])
@Index('IDX_CargoRequest_company_status', ['companyUserId', 'status'])
export class CargoRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  listingId!: string;

  @ManyToOne(() => CargoListing, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listingId', foreignKeyConstraintName: 'FK_CargoRequest_listingId' })
  listing!: CargoListing;

  @Column({ type: 'uuid' })
  driverUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driverUserId', foreignKeyConstraintName: 'FK_CargoRequest_driverUserId' })
  driver!: User;

  // همان publisherUserId بار؛ برای لیست «درخواست رانندگان» شرکت
  @Column({ type: 'uuid' })
  companyUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyUserId', foreignKeyConstraintName: 'FK_CargoRequest_companyUserId' })
  company!: User;

  @Column({ type: 'varchar', length: 20, default: CargoRequestStatus.Pending })
  status!: CargoRequestStatus;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt?: Date | null;

  // بار سپرده‌شده (OFFERED) تا این زمان منتظر تأیید راننده است
  @Column({ type: 'timestamp', nullable: true })
  offerExpiresAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
