import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';

import { Driver } from './driver.entity';
import { Vehicle } from './Vehicle';

@Entity('DriverVehicle')
export class DriverVehicle {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  driverId: string;

  @Column({ type: 'uuid' })
  vehicleId: string;

  @ManyToOne(
    () => Driver,
    driver => driver.vehicles,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'driverId' })
  driver: Driver;

  @ManyToOne(
    () => Vehicle,
    vehicle => vehicle.drivers,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Vehicle;

  @Column({ type: 'timestamp' })
  fromDate: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  toDate?: Date;

  @Column({
    type: 'boolean',
    default: true,
  })
  isCurrent: boolean;

  @CreateDateColumn()
  createdAt: Date;
}