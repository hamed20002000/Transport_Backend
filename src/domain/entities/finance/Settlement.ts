import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { Trip } from '../trip/Trip';
import { Payment } from './Payment';

@Entity('Settlement')
@Index(['status'])
export class Settlement {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
    unique: true,
  })
  tripId!: string;

  @OneToOne(
    () => Trip,
    trip => trip.settlement,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

  /*
   * Freight
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  freightAmount!: number;

  /*
   * Deductions
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  companyCharge!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  insuranceAmount!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  taxAmount!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  advancePayment!: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  otherDeductions!: number;

  /*
   * Final payable
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  driverPayable!: number;

  /*
   * How much has actually been paid
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  paidAmount!: number;

  /*
   * Status
   */

  @Column({
    type: 'smallint',
    default: 0,
  })
  status!: number;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  settledAt?: Date;

  @OneToMany(
    () => Payment,
    payment => payment.settlement,
  )
  payments!: Payment[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}