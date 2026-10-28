import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * یک دوره‌ی دسترسی واسط: بار این شرکت‌ها را از startAt تا expireAt می‌بیند و درخواست می‌دهد. شرکتی که وسط دوره
 * اضافه می‌شود به همین ردیف می‌آید؛ orderId سفارش NEW است که دوره را ساخت (null: هدیه‌ی ادمین، grantedBy).
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

  @Column({ type: 'timestamp' })
  expireAt!: Date;

  @Column({ type: 'uuid', nullable: true, unique: true })
  orderId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  grantedBy?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
