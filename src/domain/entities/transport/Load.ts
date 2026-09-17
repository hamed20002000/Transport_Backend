import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany
} from 'typeorm';

import { CargoType } from '../cargo/CargoType';
import { VehicleType } from '../vehicle/VehicleType';
import { DriverMatch } from '../matching/DriverMatch';
import { LoadOffer } from './LoadOffer';
import { DriverLoadRequest } from './DriverLoadRequest';
import { LoadAssignment } from './LoadAssignment';
import { RouteOption } from '../trip/RouteOption';
import { TransportRequest } from './TransportRequest';
import { TransportCompany } from '../company/TransportCompany';
import { Location } from '../location/Location';
import { TrailerType } from '../vehicle/TrailerType';

@Entity('Load')
@Index(['status', 'publishedAt'])
@Index(['originLocationId', 'destinationLocationId'])
@Index(['requiredVehicleTypeId', 'requiredTrailerTypeId'])
export class Load {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /*
   * Transport Request
   */

  @Column({ type: 'uuid' })
  transportRequestId!: string;

  @ManyToOne(
    () => TransportRequest,
    request => request.loads,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'transportRequestId' })
  transportRequest!: TransportRequest;

  /*
   * Transport Company
   */

  @Column({ type: 'uuid' })
  transportCompanyId!: string;

  @ManyToOne(() => TransportCompany)
  @JoinColumn({ name: 'transportCompanyId' })
  transportCompany!: TransportCompany;

  /*
   * Load Number
   */

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  loadNumber!: string;

  /*
   * Origin
   */

  @Column({ type: 'uuid' })
  originLocationId!: string;

  @ManyToOne(() => Location)
  @JoinColumn({ name: 'originLocationId' })
  originLocation!: Location;

  /*
   * Destination
   */

  @Column({ type: 'uuid' })
  destinationLocationId!: string;

  @ManyToOne(() => Location)
  @JoinColumn({ name: 'destinationLocationId' })
  destinationLocation!: Location;

  /*
   * Cargo
   */

  @Column({ type: 'uuid' })
  cargoTypeId!: string;

  @ManyToOne(
    () => CargoType,
    cargoType => cargoType.loads,
  )
  @JoinColumn({ name: 'cargoTypeId' })
  cargoType!: CargoType;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  cargoTitle?: string;

  @Column({
    type: 'text',
    nullable: true,
  })
  cargoDescription?: string;

  @Column({
    type: 'decimal',
    precision: 14,
    scale: 2,
  })
  weightKg!: number;

  /*
   * Vehicle
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  requiredVehicleTypeId?: string;

  @ManyToOne(
    () => VehicleType,
    vehicleType => vehicleType.loads,
    {
      nullable: true,
    },
  )
  @JoinColumn({ name: 'requiredVehicleTypeId' })
  requiredVehicleType?: VehicleType;

  /*
   * Trailer
   */

  @Column({
    type: 'uuid',
    nullable: true,
  })
  requiredTrailerTypeId?: string;

  @ManyToOne(
    () => TrailerType,
    {
      nullable: true,
    },
  )
  @JoinColumn({ name: 'requiredTrailerTypeId' })
  requiredTrailerType?: TrailerType;

  /*
   * Loading
   */

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  loadingFrom?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  loadingTo?: Date;

  /*
   * Delivery
   */

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  deliveryDeadline?: Date;

  /*
   * Freight
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  freightAmount?: number;

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
   * Publication
   */

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  publishedAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  expiresAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(
  () => DriverMatch,
  match => match.load,
)
driverMatches!: DriverMatch[];

@OneToMany(
  () => LoadOffer,
  offer => offer.load,
)
offers!: LoadOffer[];

@OneToMany(
  () => DriverLoadRequest,
  request => request.load,
)
driverRequests!: DriverLoadRequest[];

@OneToMany(
  () =>LoadAssignment,
  assignment => assignment.load,
)
assignments!: LoadAssignment[];

@OneToMany(
  () => RouteOption,
  route => route.load,
)
routeOptions!: RouteOption[];


}