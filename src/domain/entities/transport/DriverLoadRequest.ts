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
import { Vehicle } from '../vehicle/Vehicle';
import { Trailer } from '../vehicle/Trailer';

@Entity('DriverLoadRequest')
@Index(['loadId', 'status'])
@Index(['driverId', 'status'])
export class DriverLoadRequest {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /*
   * Load
   */

  @Column({ type: 'uuid' })
  loadId!: string;

  @ManyToOne(
    () => Load,
    load => load.driverRequests,
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
   * Driver proposed freight
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  requestedFreightAmount?: number;

  /*
   * Driver note
   */

  @Column({
    type: 'text',
    nullable: true,
  })
  description?: string;

  /*
   * Status
   */

  @Column({
    type: 'smallint',
    default: 0,
  })
  status!: number;

  /*
   * Review
   */

  @CreateDateColumn()
  requestedAt!: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  reviewedAt?: Date;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  reviewedBy?: string;

  @Column({
    type: 'text',
    nullable: true,
  })
  rejectReason?: string;
}