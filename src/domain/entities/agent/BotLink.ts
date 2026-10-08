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
import type { BotPlatform } from '../../../services/messengerBot/core/botPlatform';

/**
 * اتصال حساب پیام‌رسان (ربات تلگرام، بله یا روبیکا) به کاربر سامانه. هر
 * کاربر در هر پیام‌رسان حداکثر یک اتصال دارد؛ شناسه‌های بله/روبیکا پیشوند
 * دارند (bale:…، rubika:…) -- botPlatform.ts.
 */
@Entity('BotLink')
@Index(
  'UQ_BotLink_UserId_Platform',
  ['userId', 'platform'],
  { unique: true },
)
export class BotLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // شناسه‌ی کاربر در پیام‌رسان (تلگرام: 123، بله: bale:123، روبیکا: rubika:b0…)
  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
  })
  externalUserId!: string;

  @Column({
    type: 'varchar',
    length: 100,
  })
  chatId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'telegram',
  })
  platform!: BotPlatform;

  // اتصال فقط بعد از ساخته شدن کاربر سامانه ثبت می‌شود؛ کاربر ناشناس رکورد ندارد.
  @Column({
    type: 'uuid',
  })
  userId!: string;

  @ManyToOne(
    () => User,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({
    name: 'userId',
  })
  user?: User;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  externalUsername?: string;

  @Column({
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  firstName?: string;

  @Column({
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  lastName?: string;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  lastInteractionAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}