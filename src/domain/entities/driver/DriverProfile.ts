import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';

const decimalNumber = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? null : Number(value)),
};

/**
 * مدارک و ناوگان راننده‌ای که از پنل یا ربات ثبت‌نام کرده. نام و کد ملی روی
 * خود User است؛ همه‌ی فیلدها اختیاری‌اند. (جدول قدیمی Driver/Vehicle قیدهای
 * اجباری دارد و برای پروفایل خودِ راننده استفاده نمی‌شود.)
 */
@Entity('DriverProfile')
export class DriverProfile {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_DriverProfile_userId' })
  user!: User;

  // کارت هوشمند راننده
  @Column({ type: 'varchar', length: 20, nullable: true })
  smartCardNumber?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  licenseNumber?: string | null;

  // شهری که راننده معمولاً از آن بار می‌گیرد (پیشنهاد بار برگشتی)
  @Column({ type: 'varchar', length: 100, nullable: true })
  homeCity?: string | null;

  // مثل نوع خودروی بارها: «تریلی کفی»، «جفت»، «ده‌چرخ» ...
  @Column({ type: 'varchar', length: 100, nullable: true })
  vehicleType?: string | null;

  // برند و مدل، مثلاً «ولوو FH500»
  @Column({ type: 'varchar', length: 100, nullable: true })
  vehicleModel?: string | null;

  // «12-ع-345-67»: دو رقم، حرف، سه رقم، کد استان
  @Column({ type: 'varchar', length: 20, nullable: true })
  plate?: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true, transformer: decimalNumber })
  capacityTons?: number | null;

  // کارت هوشمند ناوگان
  @Column({ type: 'varchar', length: 20, nullable: true })
  fleetCardNumber?: string | null;

  // نام فایل در DRIVER_PHOTO_DIR (خارج از /uploads عمومی)
  @Column({ type: 'varchar', length: 60, nullable: true })
  vehiclePhoto?: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  platePhoto?: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
