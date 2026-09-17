import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { VehicleType } from './VehicleType';
import { DriverVehicle } from './DriverVehicle';

@Entity('Vehicle')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  vehicleTypeId!: string;

  @ManyToOne(
    () => VehicleType,
    vehicleType => vehicleType.vehicles,
  )
  @JoinColumn({ name: 'vehicleTypeId' })
  vehicleType!: VehicleType;

  @Column({
    type: 'varchar',
    length: 30,
    unique: true,
  })
  plate!: string;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    unique: true,
  })
  vin?: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  brand?: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  model?: string;

  @Column({
    type: 'int',
    nullable: true,
  })
  year?: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  capacityKg!: number;

  @Column({
    type: 'smallint',
    nullable: true,
  })
  fuelType?: number;

  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  averageFuelConsumption?: number;

  @Column({
    type: 'smallint',
    default: 0,
  })
  verificationStatus!: number;

  @Column({
    type: 'smallint',
    default: 0,
  })
  recordStatus!: number;

  @OneToMany(
    () => DriverVehicle,
    driverVehicle => driverVehicle.vehicle,
  )
  drivers!: DriverVehicle[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}