import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Trip } from '../trip/Trip';

@Entity('LoadingOrder')
export class LoadingOrder {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
    unique: true,
  })
  tripId!: string;

  @OneToOne(
    () => Trip,
    trip => trip.loadingOrder,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

  /*
   * Internal / external order number
   */

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  orderNumber!: string;

  /*
   * Loading information
   */

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  scheduledLoadingAt?: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  validUntil?: Date;

  @Column({
    type: 'text',
    nullable: true,
  })
  loadingInstructions?: string;

  /*
   * External reference
   */

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  externalReference?: string;

  /*
   * Document
   */

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  fileUrl?: string;

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
  issuedAt?: Date;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  issuedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}