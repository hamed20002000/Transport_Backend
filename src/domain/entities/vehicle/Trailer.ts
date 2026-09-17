import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TrailerType } from './TrailerType';

@Entity('Trailer')
export class Trailer {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trailerTypeId!: string;

  @ManyToOne(
    () => TrailerType,
    type => type.trailers,
  )
  @JoinColumn({ name: 'trailerTypeId' })
  trailerType!: TrailerType;

  @Column({
    type: 'varchar',
    length: 30,
    unique: true,
  })
  plate!: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  capacityKg!: number;

  @Column({
    type: 'smallint',
    default: 0,
  })
  verificationStatus!: number;

  @Column({
    type: 'smallint',
    default: 0,
  })
  recordStatus!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}