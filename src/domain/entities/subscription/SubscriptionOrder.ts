import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SubscriptionPlan } from './SubscriptionPlan';
import { PaymentReceipt } from './PaymentReceipt';

import { AccountType } from 'src/domain/enums/subscription';
import { CommunicationProvider } from 'src/domain/enums/subscription';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';

@Entity('SubscriptionOrder')
export class SubscriptionOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: CommunicationProvider,
  })
  provider!: CommunicationProvider;

  @Index()
  @Column({
    type: 'varchar',
    length: 150,
  })
  providerUserId!: string;

  @Column({
    type: 'varchar',
    length: 20,
  })
  phoneNumber!: string;

  @Column({
    type: 'enum',
    enum: AccountType,
  })
  accountType!: AccountType;

  @Column({
    type: 'uuid',
  })
  subscriptionPlanId!: string;

  @ManyToOne(
    () => SubscriptionPlan,
    {
      nullable: false,
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({
    name: 'subscriptionPlanId',
  })
  subscriptionPlan!: SubscriptionPlan;

  @Column({
    type: 'bigint',
  })
  amount!: string;

  @Column({
    type: 'varchar',
    length: 10,
    default: 'IRR',
  })
  currency!: string;

  @Column({
    type: 'enum',
    enum: SubscriptionOrderStatus,
    default: SubscriptionOrderStatus.WaitingForReceipt,
  })
  status!: SubscriptionOrderStatus;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  createdUserId?: string;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  approvedAt?: Date;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  approvedByUserId?: string;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  rejectedAt?: Date;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  rejectionReason?: string;

  @OneToMany(
    () => PaymentReceipt,
    receipt => receipt.order,
  )
  receipts!: PaymentReceipt[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}