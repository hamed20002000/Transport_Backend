import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * شرکت‌هایی که واسط خودش انتخاب کرده و (وقتی ادمین سقف شرکت گذاشته) فقط بار همان‌ها را می‌بیند؛ expireAt null یعنی
 * بی‌زمان (خریدهای قدیمی مدت داشتند). orderId سفارش قدیمی NEW است که آن را ساخت (null: انتخاب خود واسط یا ادمین).
 */
@Entity('BrokerAccessPeriod')
@Index('IDX_BrokerAccessPeriod_user', ['userId', 'expireAt'])
export class BrokerAccessPeriod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column('uuid', { array: true })
  companyUserIds!: string[];

  @Column({ type: 'timestamp' })
  startAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  expireAt!: Date | null;

  @Column({ type: 'uuid', nullable: true, unique: true })
  orderId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  grantedBy?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
