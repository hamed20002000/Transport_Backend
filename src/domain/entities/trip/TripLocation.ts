import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { Trip } from './Trip';

@Entity('TripLocation')
@Index(['tripId', 'recordedAt'])
@Index(['recordedAt'])
export class TripLocation {

  @PrimaryGeneratedColumn({
    type: 'bigint',
  })
  id!: string;

  @Column({
    type: 'uuid',
  })
  tripId!: string;

  @ManyToOne(
    () => Trip,
    trip => trip.locations,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
  })
  latitude!: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
  })
  longitude!: number;

  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  speed?: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  heading?: number;

  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  accuracy?: number;

  @Column({
    type: 'timestamp',
  })
  recordedAt!: Date;
}