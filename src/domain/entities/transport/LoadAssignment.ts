import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { Load } from './Load';
import { Driver } from '../driver/Driver';
import { Vehicle } from '../vehicle/Vehicle';
import { Trailer } from '../vehicle/Trailer';
import { LoadOffer } from './LoadOffer';
import { DriverLoadRequest } from './DriverLoadRequest';
import { Trip } from '../trip/Trip';

@Entity('LoadAssignment')
@Index(['loadId', 'status'])
@Index(['driverId', 'status'])
export class LoadAssignment {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /*
   * Load
   */

  @Column({ type: 'uuid' })
  loadId!: string;

  @ManyToOne(
    () => Load,
    load => load.assignments,
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
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'driverId' })
  driver!: Driver;

  /*
   * Vehicle
   */

  @Column({ type: 'uuid' })
  vehicleId!: string;

  @ManyToOne(
    () => Vehicle,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'vehicleId' })
  vehicle!: Vehicle;

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
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'trailerId' })
  trailer?: Trailer;

  /*
   * Assignment Source
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  loadOfferId?: string;

  @ManyToOne(
    () => LoadOffer,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'loadOfferId' })
  loadOffer?: LoadOffer;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  driverLoadRequestId?: string;

  @ManyToOne(
    () => DriverLoadRequest,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'driverLoadRequestId' })
  driverLoadRequest?: DriverLoadRequest;

  /*
   * Agreed Freight
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  agreedFreightAmount?: number;

  /*
   * Status
   */

  @Column({
    type: 'smallint',
    default: 0,
  })
  status!: number;

  /*
   * Assignment information
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  assignedBy?: string;

  @CreateDateColumn()
  assignedAt!: Date;

  /*
   * Cancellation
   */

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  cancelledAt?: Date;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  cancelledBy?: string;

  @Column({
    type: 'text',
    nullable: true,
  })
  cancellationReason?: string;

  /*
   * Trip
   */

  @OneToOne(
    () => Trip,
    trip => trip.assignment,
  )
  trip?: Trip;

  @UpdateDateColumn()
  updatedAt!: Date;
}