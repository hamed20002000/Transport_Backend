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

@Entity('DeliveryProof')
export class DeliveryProof {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
    unique: true,
  })
  tripId!: string;

  @OneToOne(
    () => Trip,
    trip => trip.deliveryProof,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

  /*
   * Receiver
   */

  @Column({
    type: 'varchar',
    length: 200,
  })
  receiverName!: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  receiverMobile?: string;

  /*
   * Verification Method
   */

  @Column({
    type: 'smallint',
  })
  method!: number;

  /*
   * Never store raw OTP
   */

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  otpCodeHash?: string;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  signatureUrl?: string;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  photoUrl?: string;

  /*
   * Delivery position
   */

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
    type: 'timestamp',
  })
  deliveredAt!: Date;

  @Column({
    type: 'text',
    nullable: true,
  })
  notes?: string;

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