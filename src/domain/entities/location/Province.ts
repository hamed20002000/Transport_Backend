import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { City } from './City';
import { Location } from './Location';

@Entity('Province')
export class Province {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 100,
  })
  name!: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    unique: true,
  })
  code?: string;

  @Column({
    type: 'smallint',
    default: 0,
  })
  recordStatus!: number;

  @OneToMany(() => City, city => city.province)
  cities!: City[];

  @OneToMany(() => Location, location => location.province)
  locations!: Location[];
}