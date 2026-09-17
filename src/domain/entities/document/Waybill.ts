import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { Trip } from '../trip/Trip';

@Entity('Waybill')
@Index(['waybillNumber'])
export class Waybill {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
    unique: true,
  })
  tripId!: string;

  @OneToOne(
    () => Trip,
    trip => trip.waybill,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
  })
  waybillNumber!: string;

  /*
   * Parties
   */

  @Column({
    type: 'varchar',
    length: 200,
  })
  senderName!: string;

  @Column({
    type: 'varchar',
    length: 200,
  })
  receiverName!: string;

  /*
   * Cargo snapshot
   */

  @Column({
    type: 'varchar',
    length: 250,
  })
  cargoDescription!: string;

  @Column({
    type: 'decimal',
    precision: 14,
    scale: 2,
  })
  weightKg!: number;

  /*
   * Financial snapshot
   */

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  freightAmount?: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  insuranceAmount?: number;

  /*
   * Issue
   */

  @Column({
    type: 'timestamp',
  })
  issueDate!: Date;

  /*
   * External system
   */

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  externalReference?: string;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  fileUrl?: string;

  @Column({
    type: 'smallint',
    default: 0,
  })
  status!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}