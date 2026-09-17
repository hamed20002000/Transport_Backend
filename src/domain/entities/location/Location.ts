import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Province } from './Province';
import { City } from './City';

@Entity('Location')
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  title?: string;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  provinceId?: string;

  @ManyToOne(
    () => Province,
    province => province.locations,
    {
      nullable: true,
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'provinceId' })
  province?: Province;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  cityId?: string;

  @ManyToOne(
    () => City,
    city => city.locations,
    {
      nullable: true,
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'cityId' })
  city?: City;

  @Column({
    type: 'text',
    nullable: true,
  })
  address?: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  postalCode?: string;

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}