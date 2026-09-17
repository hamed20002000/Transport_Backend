import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Load } from './Load';
import { TransportCompany } from '../company/TransportCompany';
import { Customer } from '../company/Customer';
import { Location } from '../location/Location';
import { TrailerType } from '../vehicle/TrailerType';

@Entity('TransportRequest')
export class TransportRequest {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /*
   * Transport Company
   */

  @Column({ type: 'uuid' })
  transportCompanyId!: string;

  @ManyToOne(
    () => TransportCompany,
    company => company.transportRequests,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'transportCompanyId' })
  transportCompany!: TransportCompany;

  /*
   * Customer
   */

  @Column({ type: 'uuid' })
  customerId!: string;

  @ManyToOne(
    () => Customer,
    customer => customer.transportRequests,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'customerId' })
  customer!: Customer;

  /*
   * Request Number
   */

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  requestNumber!: string;

  /*
   * Origin
   */

  @Column({ type: 'uuid' })
  originLocationId!: string;

  @ManyToOne(
    () => Location,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'originLocationId' })
  originLocation!: Location;

  /*
   * Destination
   */

  @Column({ type: 'uuid' })
  destinationLocationId!: string;

  @ManyToOne(
    () => Location,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'destinationLocationId' })
  destinationLocation!: Location;

  /*
   * Cargo
   */

  @Column({
    type: 'varchar',
    length: 200,
  })
  cargoTitle!: string;

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
  totalWeightKg!: number;

  @Column({
    type: 'int',
    default: 1,
  })
  totalVehicleCount!: number;

  /*
   * Required Trailer
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
      onDelete: 'RESTRICT',
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
  requestedDeliveryAt?: Date;

  /*
   * Customer Price
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  customerPrice?: number;

  /*
   * Description
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
   * Loads
   *
   * One TransportRequest can generate multiple Loads.
   */

  @OneToMany(
    () => Load,
    load => load.transportRequest,
  )
  loads!: Load[];

  /*
   * Audit
   */

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}