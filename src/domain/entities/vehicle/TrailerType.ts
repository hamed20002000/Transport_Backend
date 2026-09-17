import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';

import { Trailer } from './Trailer';

@Entity('TrailerType')
export class TrailerType {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'varchar',
    length: 100,
  })
  title: string;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  code: string;

  @Column({
    type: 'smallint',
    default: 0,
  })
  recordStatus: number;

  @OneToMany(
    () => Trailer,
    trailer => trailer.trailerType,
  )
  trailers: Trailer[];
}