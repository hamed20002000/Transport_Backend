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
import { SubscriptionPlan } from './SubscriptionPlan';
import { SubscriptionOrder } from './SubscriptionOrder';
import { SubscriptionStatus } from 'src/domain/enums/subscription';

@Entity('Subscription')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({
    type: 'uuid',
  })
  userId!: string;

  @ManyToOne(
    () => User,
    {
      nullable: false,
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({
    name: 'userId',
  })
  user!: User;

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
    type: 'uuid',
  })
  orderId!: string;

  @ManyToOne(
    () => SubscriptionOrder,
    {
      nullable: false,
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({
    name: 'orderId',
  })
  order!: SubscriptionOrder;

  @Column({
    type: 'timestamp',
  })
  startAt!: Date;

  @Column({
    type: 'timestamp',
  })
  expireAt!: Date;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.Active,
  })
  status!: SubscriptionStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}