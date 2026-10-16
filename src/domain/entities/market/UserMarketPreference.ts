import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { User } from '../auth/User';

/** قلم‌هایی که کاربر در نوار قیمت (وب و ربات) می‌بیند، به ترتیب انتخاب؛ بدون ردیف یعنی پیش‌فرض. */
@Entity('UserMarketPreference')
export class UserMarketPreference {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_UserMarketPreference_userId' })
  user!: User;

  @Column('text', { array: true, default: () => "'{}'" })
  symbols!: string[];

  @UpdateDateColumn()
  updatedAt!: Date;
}
