import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';
import { CompanyFeaturePlan } from './CompanyFeaturePlan';
import { CompanyFeature, CompanyTier } from '../../enums/companyFeature';
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

  /** a menu's plan; null for a tier */
  @Column({ type: 'uuid', nullable: true })
  planId!: string | null;

  @ManyToOne(() => CompanyFeaturePlan, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'planId' })
  plan?: CompanyFeaturePlan | null;

  /** the one menu bought; null for a tier */
  @Column({ type: 'varchar', length: 40, nullable: true })
  feature!: CompanyFeature | null;

  /** a tier (برنزی، نقره‌ای، طلایی) bought: its menus as they were then, so a later change of the tier does not touch it */
  @Column({ type: 'varchar', length: 10, nullable: true })
  tier!: CompanyTier | null;

  @Column({ type: 'varchar', length: 40, array: true, nullable: true })
  features!: CompanyFeature[] | null;

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
