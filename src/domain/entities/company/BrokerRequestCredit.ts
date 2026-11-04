import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * درخواست‌های بار باقی‌مانده‌ی واسط: هر بسته‌ی خریده (یا هدیه‌ی ادمین) به آن اضافه می‌شود و هر درخواست بار یکی کم
 * می‌کند. زمان ندارد.
 */
@Entity('BrokerRequestCredit')
export class BrokerRequestCredit {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'int', default: 0 })
  remaining!: number;

  @UpdateDateColumn()
  updatedAt!: Date;
}
