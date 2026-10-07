import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * جایگاه سوخت از OpenStreetMap؛ یک بار در ماه برای کل ایران به‌روز می‌شود تا
 * پیدا کردن جایگاه‌های هر مسیر بدون درخواست بیرونی و فوری باشد.
 */
@Entity('FuelStation')
@Index('IDX_FuelStation_lat_lng', ['latitude', 'longitude'])
export class FuelStation {
  // شناسه‌ی OSM با نوعش، مثل n123 یا w456
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name?: string | null;

  @Column({ type: 'double precision' })
  latitude!: number;

  @Column({ type: 'double precision' })
  longitude!: number;

  // null یعنی در OSM ثبت نشده (نه اینکه ندارد)
  @Column({ type: 'boolean', nullable: true })
  diesel?: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  cng?: boolean | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
