import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../auth/User';
import { CargoListing } from '../notification/CargoListing';

export type BrokerDriverOfferStatus = 'SENT' | 'ACCEPTED' | 'DECLINED' | 'CLOSED';

/**
 * «معرفی راننده»: a broker asked for drivers for a load (a paid suggestion), and this driver was told of it — the
 * broker's name and the load, never the driver's number to the broker. The first driver who wants it becomes the
 * driver of the broker's request (CargoRequest.forDriver, from its own profile); the others' offers close.
 */
@Entity('BrokerDriverOffer')
@Index('UQ_BrokerDriverOffer_listing_broker_driver', ['listingId', 'brokerUserId', 'driverUserId'], { unique: true })
@Index('IDX_BrokerDriverOffer_driver_status', ['driverUserId', 'status'])
export class BrokerDriverOffer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  brokerUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brokerUserId' })
  broker!: User;

  @Column({ type: 'uuid' })
  listingId!: string;

  @ManyToOne(() => CargoListing, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listingId' })
  listing!: CargoListing;

  @Column({ type: 'uuid' })
  driverUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driverUserId' })
  driver!: User;

  /** why this driver was picked, e.g. «۷ بار تهران ← مشهد» */
  @Column({ type: 'varchar', length: 200 })
  reason!: string;

  @Column({ type: 'varchar', length: 20, default: 'SENT' })
  status!: BrokerDriverOfferStatus;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  respondedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
