import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * سابقه‌ی موقعیت‌های راننده با زمان دریافت؛ برای اینکه شرکت مسیر طی‌شده و
 * زمان هر موقعیت را ببیند. به‌روزرسانی‌های Live با فاصله‌ی زمانی/مکانی ثبت
 * می‌شوند تا جدول بی‌دلیل بزرگ نشود؛ قدیمی‌تر از ۳۰ روز پاک می‌شود.
 */
@Entity('DriverLocationLog')
@Index('IDX_DriverLocationLog_user_received', ['userId', 'receivedAt'])
export class DriverLocationLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_DriverLocationLog_userId' })
  user!: User;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  // از Live Location آمده (نه ارسال دستی)
  @Column({ type: 'boolean', default: false })
  live!: boolean;

  @Column({ type: 'timestamp', default: () => 'now()' })
  receivedAt!: Date;
}
