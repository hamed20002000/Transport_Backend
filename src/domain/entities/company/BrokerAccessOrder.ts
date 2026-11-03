import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';
import { SubscriptionOrderStatus } from '../../enums/subscription';

/**
 * خرید واسط با فیش کارت‌به‌کارت؛ ادمین تأیید یا رد می‌کند. PACKAGE چند بسته‌ی درخواست بار (requests درخواست)؛
 * NEW و ADD خریدهای قدیمی شرکت‌ها هستند (حالا شرکت‌ها را واسط بی‌پول انتخاب می‌کند). مبلغ و تعداد از تنظیمات همان
 * لحظه کپی می‌شوند تا تغییر بعدی روی سفارش ثبت‌شده اثر نکند.
 */
// PACKAGE: load requests; SUGGESTION: «معرفی راننده» (requests is how many, for both)
export type BrokerOrderKind = 'NEW' | 'ADD' | 'PACKAGE' | 'SUGGESTION';

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
  kind!: BrokerOrderKind;

  /** ADD: دوره‌ای که شرکت‌ها به آن اضافه می‌شوند */
  @Column({ type: 'uuid', nullable: true })
  periodId?: string | null;

  /** شرکت‌های حمل‌ونقل (User.id) که بارشان دیده می‌شود؛ برای بسته خالی */
  @Column('uuid', { array: true })
  companyUserIds!: string[];

  /** older company purchases had days; null now */
  @Column({ type: 'int', nullable: true })
  durationDays!: number | null;

  /** PACKAGE: the load requests bought (packages × the package size then) */
  @Column({ type: 'int', nullable: true })
  requests!: number | null;

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
