import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';
import { CargoTripType } from '../../enums/notification';

const decimalNumber = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? null : Number(value)),
};

/** پاسخ یک استعلام api.ir؛ inputKey هش ورودی‌هاست تا با عوض شدن مدرک دوباره استعلام شود. */
export interface VerificationAnswer {
  inputKey: string;
  checkedAt: string;
  ok: boolean;
  message?: string | null;
  data?: unknown;
}

export interface DriverVerificationRecord {
  answers: Partial<Record<string, VerificationAnswer>>;
  // سقف استعلام پولی روزانه‌ی هر راننده
  usage?: { day: string; count: number };
}

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

  // شمسی، «1370/1/1»؛ برای استعلام ثبت احوال
  @Column({ type: 'varchar', length: 10, nullable: true })
  birthDate?: string | null;

  // نتیجه‌ی استعلام‌های شاهکار، ثبت احوال و گواهینامه؛ فقط DriverVerificationService می‌نویسد
  @Column({ type: 'jsonb', nullable: true })
  verification?: DriverVerificationRecord | null;

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

  // عکس خود راننده؛ شرکت هنگام سپردن بار می‌بیند
  @Column({ type: 'varchar', length: 60, nullable: true })
  facePhoto?: string | null;

  // داخلی، صادراتی یا وارداتی؛ بار اعلام‌شده فقط به راننده‌های همان نوع می‌رسد
  @Column({ type: 'varchar', length: 10, default: CargoTripType.Domestic })
  tripType!: CargoTripType;

  // بار اعلام‌شده در پیام‌رسان‌ها با صدا هم خوانده شود (راننده پشت فرمان)
  @Column({ type: 'boolean', default: true })
  cargoVoice!: boolean;

  @UpdateDateColumn()
  updatedAt!: Date;
}
