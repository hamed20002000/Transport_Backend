import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../auth/User';

@Entity('TelegramLink')
@Index(
  'UQ_TelegramLink_TelegramUserId',
  ['telegramUserId'],
  { unique: true },
)
@Index(
  'UQ_TelegramLink_UserId',
  ['userId'],
  { unique: true },
)
export class TelegramLink {
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
    type: 'uuid',
    nullable: true,
    unique: true,
  })
  userId?: string;

  @OneToOne(
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