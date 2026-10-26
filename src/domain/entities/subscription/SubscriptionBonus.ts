import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Free days given to a user without a payment, e.g. a reward once a driver's purchases pass a threshold
 * (SubscriptionPolicy.driverRewards). While one runs the user may work like a subscriber (SubscriptionAccessService).
 * reason names what earned it; the same reason is never given twice to one user.
 */
@Entity('SubscriptionBonus')
@Unique('UQ_SubscriptionBonus_user_reason', ['userId', 'reason'])
@Index('IDX_SubscriptionBonus_user_expire', ['userId', 'expireAt'])
export class SubscriptionBonus {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  // e.g. «paid:20000000» (purchases passed 20 million tomans)
  @Column({ type: 'varchar', length: 64 })
  reason!: string;

  @Column({ type: 'int' })
  days!: number;

  // starts after whatever the user already has (subscription or an earlier bonus), so no paid day is lost
  @Column({ type: 'timestamp' })
  startAt!: Date;

  @Column({ type: 'timestamp' })
  expireAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
