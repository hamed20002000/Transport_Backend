import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { Load } from '../transport/Load';

@Entity('RouteOption')
@Index(['loadId', 'score'])
export class RouteOption {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  loadId!: string;

  @ManyToOne(
    () => Load,
    load => load.routeOptions,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'loadId' })
  load!: Load;

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

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  estimatedFuelLiters?: number;

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

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  score?: number;

  @Column({
    type: 'text',
    nullable: true,
  })
  encodedPolyline?: string;

  @Column({
    type: 'boolean',
    default: false,
  })
  isSelected!: boolean;

  @CreateDateColumn()
  calculatedAt!: Date;
}