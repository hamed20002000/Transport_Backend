import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { Load } from '../transport/Load';
import { Driver } from '../driver/Driver';
import { DriverAvailability } from '../driver/DriverAvailability';

@Entity('DriverMatch')
@Index(['loadId', 'totalScore'])
@Index(['driverId', 'calculatedAt'])
@Index(['loadId', 'driverId'])
export class DriverMatch {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /*
   * Load
   */

  @Column({ type: 'uuid' })
  loadId!: string;

  @ManyToOne(
    () => Load,
    load => load.driverMatches,
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
   * Availability used for calculation
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  driverAvailabilityId?: string;

  @ManyToOne(
    () => DriverAvailability,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'driverAvailabilityId' })
  driverAvailability?: DriverAvailability;

  /*
   * Total Score
   */

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
  })
  totalScore!: number;

  /*
   * Score Details
   */

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  distanceScore!: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  vehicleScore!: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  trailerScore!: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  routeScore!: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  reliabilityScore!: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    default: 0,
  })
  returnLoadScore!: number;

  /*
   * Distance to pickup
   */

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  distanceToPickupKm?: number;

  @Column({
  type: 'decimal',
  precision: 6,
  scale: 2,
  default: 0,
})
priceScore!: number;

  /*
   * Algorithm
   */

  @Column({
    type: 'varchar',
    length: 50,
  })
  algorithmVersion!: string;

  @CreateDateColumn()
  calculatedAt!: Date;
}