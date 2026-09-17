import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { Driver } from './Driver';
import { Vehicle } from '../vehicle/Vehicle';
import { Trailer } from '../vehicle/Trailer';
import { City } from '../location/City';

@Entity('DriverAvailability')
@Index(['driverId', 'status'])
@Index(['originCityId', 'status'])
@Index(['availableFrom', 'availableUntil'])
export class DriverAvailability {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /*
   * Driver
   */

  @Column({ type: 'uuid' })
  driverId!: string;

  @ManyToOne(
    () => Driver,
    driver => driver.availabilities,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'driverId' })
  driver!: Driver;

  /*
   * Vehicle
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  vehicleId?: string;

  @ManyToOne(
    () => Vehicle,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'vehicleId' })
  vehicle?: Vehicle;

  /*
   * Trailer
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  trailerId?: string;

  @ManyToOne(
    () => Trailer,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'trailerId' })
  trailer?: Trailer;

  /*
   * Availability Time
   */

  @Column({
    type: 'timestamp',
  })
  availableFrom!: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  availableUntil?: Date;

  /*
   * Current / Starting City
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  originCityId?: string;

  @ManyToOne(
    () => City,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'originCityId' })
  originCity?: City;

  /*
   * Preferred Destination
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  preferredDestinationCityId?: string;

  @ManyToOne(
    () => City,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'preferredDestinationCityId' })
  preferredDestinationCity?: City;

  /*
   * Current Position
   */

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  currentLatitude?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  currentLongitude?: number;

  /*
   * Minimum acceptable freight
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  minimumFreightAmount?: number;

  /*
   * Status
   */

  @Column({
    type: 'smallint',
    default: 0,
  })
  status!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}