import { Column, Entity, PrimaryColumn } from 'typeorm';

import { UsageChannel } from './usageChannel';

/**
 * Load notices delivered on a day through a channel (a messenger, or push): what notification engagement is measured
 * against. Counted apart from CargoNotification, whose rows are deleted once their loads are done.
 */
@Entity('NotificationDailyStat')
export class NotificationDailyStat {
  @PrimaryColumn({ type: 'date' })
  day!: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  channel!: UsageChannel;

  @Column({ type: 'int', default: 0 })
  delivered!: number;
}
