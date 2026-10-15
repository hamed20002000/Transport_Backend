import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';
import { CargoAnnounceMode } from '../../enums/notification';

/**
 * اعلام بار شرکت به راننده‌ها: دستی (پیش‌فرض؛ دکمه‌ی «اعلام بار» و ثبت بار)، یا خودکار
 * هر intervalMinutes: بارهای پیشنهادی تازه‌ی کانال‌ها و بارهای ثبت‌شده‌ی در صف اعلام می‌شوند.
 */
@Entity('CompanyAnnounceSetting')
export class CompanyAnnounceSetting {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_CompanyAnnounceSetting_userId' })
  user!: User;

  @Column({ type: 'varchar', length: 10, default: CargoAnnounceMode.Manual })
  mode!: CargoAnnounceMode;

  @Column({ type: 'int', default: 120 })
  intervalMinutes!: number;

  // از این زمان به بعد پیشنهادها خودکار اعلام می‌شوند (پیشنهادهای قدیمی‌تر نه)
  @Column({ type: 'timestamp', nullable: true })
  autoSince?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRunAt?: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
