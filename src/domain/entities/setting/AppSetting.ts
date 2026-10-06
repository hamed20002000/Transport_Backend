import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** تنظیمات قابل تغییر در زمان اجرا (بدون ری‌استارت)، مثل سیاست اشتراک. */
@Entity('AppSetting')
export class AppSetting {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId?: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
