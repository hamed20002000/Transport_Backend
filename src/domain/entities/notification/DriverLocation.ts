import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';

/** آخرین موقعیتی که راننده در ربات فرستاده (لوکیشن یا Live Location). */
@Entity('DriverLocation')
export class DriverLocation {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_DriverLocation_userId' })
  user!: User;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  // تا این زمان Live Location تلگرام به‌روز می‌شود؛ null یعنی لوکیشن یک‌باره
  @Column({ type: 'timestamp', nullable: true })
  liveUntil?: Date | null;

  // زمان دریافت همین موقعیت در سرور (برای «آخرین موقعیت: ۱۴۰۵/۰۷/۱۵ ساعت ۱۴:۳۲»)
  @Column({ type: 'timestamp', default: () => 'now()' })
  receivedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
