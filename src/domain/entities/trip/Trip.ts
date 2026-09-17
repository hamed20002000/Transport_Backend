import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { LoadAssignment } from '../transport/LoadAssignment';
import { Load } from '../transport/Load';
import { TransportCompany } from '../company/TransportCompany';
import { Driver } from '../driver/Driver';
import { Vehicle } from '../vehicle/Vehicle';
import { Trailer } from '../vehicle/Trailer';
import { Route } from './Route';
import { FuelRecord } from './FuelRecord';
import { TripExpense } from './TripExpense';
import { LoadingOrder } from '../document/LoadingOrder';
import { Waybill } from '../document/Waybill';
import { DeliveryProof } from '../document/DeliveryProof';
import { Settlement } from '../finance/Settlement';
import { TripLocation } from './TripLocation';

@Entity('Trip')
@Index(['driverId', 'status'])
@Index(['transportCompanyId', 'status'])
@Index(['loadId'])
export class Trip {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /*
   * Trip Number
   */

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  tripNumber!: string;

  /*
   * Assignment
   */

  @Column({
    type: 'uuid',
    unique: true,
  })
  assignmentId!: string;

  @OneToOne(
    () => LoadAssignment,
    assignment => assignment.trip,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'assignmentId' })
  assignment!: LoadAssignment;

  /*
   * Load
   */

  @Column({ type: 'uuid' })
  loadId!: string;

  @ManyToOne(
    () => Load,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'loadId' })
  load!: Load;

  /*
   * Company
   */

  @Column({ type: 'uuid' })
  transportCompanyId!: string;

  @ManyToOne(
    () => TransportCompany,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'transportCompanyId' })
  transportCompany!: TransportCompany;

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
   * Important Times
   */

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  startedAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  arrivedPickupAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  loadingStartedAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  loadedAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  departedAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  arrivedDestinationAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  deliveredAt?: Date;

  /*
   * Distance
   */

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  originOdometer?: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  destinationOdometer?: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  estimatedDistanceKm?: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  actualDistanceKm?: number;

  /*
   * Duration
   */

  @Column({
    type: 'int',
    nullable: true,
  })
  estimatedDurationMinutes?: number;

  @Column({
    type: 'int',
    nullable: true,
  })
  actualDurationMinutes?: number;

  /*
   * Fuel
   */

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  estimatedFuelLiters?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  actualFuelLiters?: number;

  /*
   * Status
   */

  @Column({
    type: 'smallint',
    default: 0,
  })
  status!: number;

  /*
   * GPS
   */

  @OneToMany(
    () => TripLocation,
    location => location.trip,
  )
  locations!: TripLocation[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToOne(
  () => Route,
  route => route.trip,
)
route?: Route;

@OneToMany(
  () => FuelRecord,
  fuel => fuel.trip,
)
fuelRecords!: FuelRecord[];


@OneToMany(
  () => TripExpense,
  expense => expense.trip,
)
expenses!: TripExpense[];


@OneToOne(
  () => LoadingOrder,
  loadingOrder => loadingOrder.trip,
)
loadingOrder?: LoadingOrder;

@OneToOne(
  () => Waybill,
  waybill => waybill.trip,
)
waybill?: Waybill;

@OneToOne(
  () => DeliveryProof,
  deliveryProof => deliveryProof.trip,
)
deliveryProof?: DeliveryProof;

@OneToOne(
  () => Settlement,
  settlement => settlement.trip,
)
settlement?: Settlement;


}