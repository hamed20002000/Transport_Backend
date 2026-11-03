import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { UsageChannel } from './usageChannel';

/**
 * Something a user did, for the admin's figures: opened the app from a link (link_open, channel = where the link
 * was), tapped a phone notification (push_click), opened a load's details (load_detail) or asked for it
 * (load_request), channel being where it happened.
 */
export type UsageEventKind = 'link_open' | 'push_click' | 'load_detail' | 'load_request';

@Entity('UsageEvent')
@Index('IDX_UsageEvent_kind_created', ['kind', 'createdAt'])
export class UsageEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: UsageEventKind;

  @Column({ type: 'varchar', length: 20 })
  channel!: UsageChannel;

  @Column({ type: 'uuid', nullable: true })
  listingId?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
