import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { FareBasis, FareChangeReason, FareCurrency, TripFareStage } from '../../enums/tripFare';
import { User } from '../auth/User';
import { CargoRequest } from './CargoRequest';

/**
 * The fare and weight of one trip (CargoRequest) at one stage, as the company recorded them (TripFareStage):
 * AGREED when it closed the deal, DELIVERED when it confirmed the delivery. One row per stage; the AGREED row is
 * fixed once the trip starts and the DELIVERED one is written apart, so the agreed values always stay.
 * The figures read both through the "TripFareReport" view (one line per trip).
 * Amounts are decimal strings (bigint) to stay exact across JSON and JavaScript.
 */
@Entity('TripFare')
@Index('UQ_TripFare_request_stage', ['requestId', 'stage'], { unique: true })
export class TripFare {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  requestId!: string;

  @ManyToOne(() => CargoRequest, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requestId', foreignKeyConstraintName: 'FK_TripFare_requestId' })
  request!: CargoRequest;

  @Column({ type: 'varchar', length: 12 })
  stage!: TripFareStage;

  @Column({ type: 'varchar', length: 10 })
  basis!: FareBasis;

  /** what the company typed: the whole fare (TOTAL) or the fare of one ton (PER_TON) */
  @Column({ type: 'bigint' })
  rate!: string;

  @Column({ type: 'numeric', precision: 8, scale: 2 })
  weightTons!: string;

  /** the whole fare: rate, or rate × weightTons; what every figure adds up */
  @Column({ type: 'bigint' })
  total!: string;

  @Column({ type: 'varchar', length: 3, default: FareCurrency.Toman })
  currency!: FareCurrency;

  /** DELIVERED: why it differs from AGREED; null when nothing changed */
  @Column({ type: 'varchar', length: 20, nullable: true })
  changeReason?: FareChangeReason | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  enteredByUserId?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'enteredByUserId', foreignKeyConstraintName: 'FK_TripFare_enteredByUserId' })
  enteredBy?: User | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
