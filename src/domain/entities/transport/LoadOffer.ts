import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { Load } from './Load';
import { Driver } from '../driver/Driver';
import { DriverMatch } from '../matching/DriverMatch';

@Entity('LoadOffer')
@Index(['loadId', 'status'])
@Index(['driverId', 'status'])
export class LoadOffer {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /*
   * Load
   */

  @Column({ type: 'uuid' })
  loadId!: string;

  @ManyToOne(
    () => Load,
    load => load.offers,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'loadId' })
  load!: Load;

  /*
   * Driver
   */

  @Column({ type: 'uuid' })
  driverId!: string;

  @ManyToOne(
    () => Driver,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'driverId' })
  driver!: Driver;

  /*
   * Match
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  driverMatchId?: string;

  @ManyToOne(
    () => DriverMatch,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'driverMatchId' })
  driverMatch?: DriverMatch;

  /*
   * Score at time of offer
   */

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  matchScore?: number;

  /*
   * Freight offered to driver
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  offeredFreightAmount?: number;

  /*
   * Status
   */

  @Column({
    type: 'smallint',
    default: 0,
  })
  status!: number;

  /*
   * Times
   */

  @CreateDateColumn()
  sentAt!: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  seenAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  acceptedAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  rejectedAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  expiresAt?: Date;
}