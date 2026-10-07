import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../auth/User';

const bigintNumber = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? null : Number(value)),
};

/**
 * فیلتر اعلان بار یک کاربر. هر کاربر می‌تواند چند ردیف داشته باشد (مثلاً
 * «تهران به مشهد» و «هر باری از اصفهان») -- کافی است یکی match شود.
 *
 * هر فیلد یک لیست است: خالی یعنی «همه». کاربری که هیچ فیلتر فعالی ندارد
 * همه‌ی بارهای گروه‌هایی که ثبت کرده را دریافت می‌کند.
 */
@Entity('CargoAlertFilter')
export class CargoAlertFilter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_CargoAlertFilter_userId')
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_CargoAlertFilter_userId' })
  user!: User;

  @Column({ type: 'varchar', length: 150, nullable: true })
  label?: string | null;

  @Column('text', { array: true, default: () => "'{}'" })
  origins!: string[];

  @Column('text', { array: true, default: () => "'{}'" })
  destinations!: string[];

  @Column('text', { array: true, default: () => "'{}'" })
  cargoTypes!: string[];

  @Column('text', { array: true, default: () => "'{}'" })
  vehicleTypes!: string[];

  // نام شرکت منتشرکننده (برای بارهایی که شرکت‌ها برای راننده‌ها اعلام می‌کنند)
  @Column('text', { array: true, default: () => "'{}'" })
  companies!: string[];

  // بازه‌ی کرایه به تومان؛ null یعنی بدون حد. bigint در pg به‌صورت رشته برمی‌گردد، پس عدد می‌شود.
  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber })
  minPrice?: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: bigintNumber })
  maxPrice?: number | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
