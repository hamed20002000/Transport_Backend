import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../auth/User';
import { CompanyFeature } from '../../enums/companyFeature';

/**
 * یک دوره‌ی باز بودن منو برای شرکت. خرید تازه بعد از پایان دوره‌ی فعلی همان منو شروع می‌شود؛
 * orderId برای دوره‌ای که ادمین بی‌خرید داده null است.
 */
@Entity('CompanyFeatureGrant')
@Index('IDX_CompanyFeatureGrant_user_feature', ['userId', 'feature', 'expireAt'])
@Index('IDX_CompanyFeatureGrant_order', ['orderId'])
export class CompanyFeatureGrant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 40 })
  feature!: CompanyFeature;

  @Column({ type: 'timestamp' })
  startAt!: Date;

  @Column({ type: 'timestamp' })
  expireAt!: Date;

  // a tier's order opens several menus: one grant each
  @Column({ type: 'uuid', nullable: true })
  orderId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  grantedBy?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
