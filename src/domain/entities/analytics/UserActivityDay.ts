import { Column, Entity, PrimaryColumn } from 'typeorm';

import { UsageChannel } from './usageChannel';

/** A user was active on this day through this channel (one row per user, day and channel; the admin's usage figures). */
@Entity('UserActivityDay')
export class UserActivityDay {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ type: 'date' })
  day!: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  channel!: UsageChannel;

  @Column({ type: 'timestamp', default: () => 'now()' })
  firstAt!: Date;
}
