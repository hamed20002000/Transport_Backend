import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';
import { CompanyFeaturePlan } from './CompanyFeaturePlan';
import { CompanyFeature } from '../../enums/companyFeature';
import { SubscriptionOrderStatus } from '../../enums/subscription';

/**
 * خرید یک منو با فیش کارت‌به‌کارت؛ ادمین تأیید یا رد می‌کند. منو، مبلغ و مدت از پلن کپی می‌شوند تا
 * تغییر بعدی پلن روی سفارش ثبت‌شده اثر نکند.
 */
@Entity('CompanyFeatureOrder')
@Index('IDX_CompanyFeatureOrder_user', ['userId', 'createdAt'])
@Index('IDX_CompanyFeatureOrder_status', ['status', 'createdAt'])
export class CompanyFeatureOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  planId!: string;

  @ManyToOne(() => CompanyFeaturePlan, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'planId' })
  plan!: CompanyFeaturePlan;

  @Column({ type: 'varchar', length: 40 })
  feature!: CompanyFeature;

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
