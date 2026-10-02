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
@Entity('TelegramLink')
@Index(
  'UQ_TelegramLink_TelegramUserId',
  ['telegramUserId'],
  { unique: true },
)
@Index(
  'UQ_TelegramLink_UserId_Platform',
  ['userId', 'platform'],
  { unique: true },
)
export class BotLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
  })
  telegramUserId!: string;

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

  @Column({
    type: 'uuid',
    nullable: true,
  })
  userId?: string;

  @ManyToOne(
    () => User,
    {
      nullable: true,
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
  telegramUsername?: string;

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