import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  JoinColumn,
  OneToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DriverAvailability } from './DriverAvailability';
import { CompanyDriver } from '../company/Company';
import { DriverVehicle } from '../vehicle/DriverVehicle';
import { User } from '../auth/User';

@Entity('Driver')
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
    nullable: true,
    unique: true,
  })
  userId?: string;

  @Column({
    type: 'varchar',
    length: 100,
  })
  firstName!: string;

  @Column({
    type: 'varchar',
    length: 100,
  })
  lastName!: string;

  @Column({
    type: 'varchar',
    length: 20,
    unique: true,
  })
  nationalCode!: string;

  @Column({
    type: 'varchar',
    length: 20,
    unique: true,
  })
  mobile!: string;

  @Column({
    type: 'date',
    nullable: true,
  })
  birthDate?: Date;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  smartCardNumber?: string;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  licenseNumber?: string;

  @Column({
    type: 'date',
    nullable: true,
  })
  licenseExpireDate?: Date;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 0,
  })
  rating!: number;

  @Column({
    type: 'int',
    default: 0,
  })
  completedTrips!: number;

  @Column({
    type: 'int',
    default: 0,
  })
  cancelledTrips!: number;

  @Column({
    type: 'smallint',
    default: 0,
  })
  verificationStatus!: number;

  @Column({
    type: 'smallint',
    default: 0,
  })
  availabilityStatus!: number;

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

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  lastLocationAt?: Date;

  @Column({
    type: 'smallint',
    default: 0,
  })
  recordStatus!: number;

  @OneToMany(
    () => CompanyDriver,
    companyDriver => companyDriver.driver,
  )
  companies!: CompanyDriver[];

  @OneToMany(
    () => DriverVehicle,
    driverVehicle => driverVehicle.driver,
  )
  vehicles!: DriverVehicle[];

  @OneToMany(
    () => DriverAvailability,
    availability => availability.driver,
  )
  availabilities!: DriverAvailability[];

  @OneToOne(
    () => User,
    user => user.driver,
    {
      nullable: true,
      onDelete: 'SET NULL',
    },
  )
  @JoinColumn({ name: 'userId' })
  user?: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}