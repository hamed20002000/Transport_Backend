import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { Trip } from './Trip';
import { Vehicle } from '../vehicle/Vehicle';
import { Driver } from '../driver/Driver';

@Entity('FuelRecord')
@Index(['tripId', 'createdAt'])
@Index(['vehicleId', 'createdAt'])
export class FuelRecord {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tripId!: string;

  @ManyToOne(
    () => Trip,
    trip => trip.fuelRecords,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

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

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
  })
  liters!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  amount!: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  odometer?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  latitude?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  longitude?: number;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  stationName?: string;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  receiptUrl?: string;

  @CreateDateColumn()
  createdAt!: Date;
}