import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

import { Province } from './Province';
import { Location } from './Location';

@Entity('City')
export class City {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  provinceId!: string;

  @ManyToOne(
    () => Province,
    province => province.cities,
    { onDelete: 'RESTRICT' },
  )
  @JoinColumn({ name: 'provinceId' })
  province!: Province;

  @Column({
    type: 'varchar',
    length: 100,
  })
  name!: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  code?: string;

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
    type: 'smallint',
    default: 0,
  })
  recordStatus!: number;

  @OneToMany(() => Location, location => location.city)
  locations!: Location[];
}