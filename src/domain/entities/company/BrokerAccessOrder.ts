import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';
import { SubscriptionOrderStatus } from '../../enums/subscription';

/**
 * خرید دسترسی واسط به بار شرکت‌ها با فیش کارت‌به‌کارت؛ ادمین تأیید یا رد می‌کند. NEW یک دوره‌ی تازه با این شرکت‌هاست
 * (بعد از پایان دوره‌ی باز شروع می‌شود)، ADD شرکت‌های تازه برای باقی‌مانده‌ی همان دوره (periodId). مبلغ و مدت از
 * تنظیمات همان لحظه کپی می‌شوند تا تغییر بعدی قیمت روی سفارش ثبت‌شده اثر نکند.
 */
@Entity('BrokerAccessOrder')
@Index('IDX_BrokerAccessOrder_user', ['userId', 'createdAt'])
@Index('IDX_BrokerAccessOrder_status', ['status', 'createdAt'])
export class BrokerAccessOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 10 })
  kind!: 'NEW' | 'ADD';

  /** ADD: دوره‌ای که شرکت‌ها به آن اضافه می‌شوند */
  @Column({ type: 'uuid', nullable: true })
  periodId?: string | null;

  /** شرکت‌های حمل‌ونقل (User.id) که بارشان دیده می‌شود */
  @Column('uuid', { array: true })
  companyUserIds!: string[];

  @Column({ type: 'int' })
  durationDays!: number;

  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'varchar', length: 10, default: 'IRR' })
  currency!: string;

  /** فقط ReceiptSubmitted، Approved یا Rejected */
  @Column({ type: 'varchar', length: 30, default: SubscriptionOrderStatus.ReceiptSubmitted })
  status!: SubscriptionOrderStatus;

  /** عکس فیش در انبار خصوصی رسیدها (receiptStorage) */
  @Column({ type: 'text' })
  receiptPath!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  rejectionReason?: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
