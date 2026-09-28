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

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
