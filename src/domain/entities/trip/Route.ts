import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Trip } from './Trip';

@Entity('Route')
export class Route {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
    unique: true,
  })
  tripId!: string;

  @OneToOne(
    () => Trip,
    trip => trip.route,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

  /*
   * Route Provider
   *
   * OSRM
   * GraphHopper
   * Mapbox
   * Google
   */
  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  provider?: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  distanceKm!: number;

  @Column({
    type: 'int',
  })
  durationMinutes!: number;

  /*
   * Route geometry
   */
  @Column({
    type: 'text',
    nullable: true,
  })
  encodedPolyline?: string;

  /*
   * Fuel estimation
   */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  estimatedFuelLiters?: number;

  /*
   * Estimated costs
   */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  estimatedFuelCost?: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  tollCost?: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  estimatedTotalCost?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}