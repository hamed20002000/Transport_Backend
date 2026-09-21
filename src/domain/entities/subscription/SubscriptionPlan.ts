import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AccountType } from 'src/domain/enums/subscription';
import { RecordStatus } from '../../enums/RecordStatus';

@Entity('SubscriptionPlan')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 150,
  })
  title!: string;

  @Column({
    type: 'enum',
    enum: AccountType,
  })
  accountType!: AccountType;

  @Column({
    type: 'int',
  })
  durationDays!: number;

  @Column({
    type: 'bigint',
  })
  price!: string;

  @Column({
    type: 'varchar',
    length: 10,
    default: 'IRR',
  })
  currency!: string;

  @Column({
    type: 'smallint',
    default: RecordStatus.Active,
  })
  recordStatus!: RecordStatus;

  @Column({
    type: 'int',
    default: 0,
  })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}