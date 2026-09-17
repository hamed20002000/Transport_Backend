import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Load } from '../transport/Load';

@Entity('CargoType')
export class CargoType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 150,
  })
  title!: string;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  code!: string;

  @Column({
    type: 'boolean',
    default: false,
  })
  isHazardous!: boolean;

  @Column({
    type: 'boolean',
    default: false,
  })
  requiresRefrigeration!: boolean;

  @Column({
    type: 'smallint',
    default: 0,
  })
  recordStatus!: number;

  @OneToMany(() => Load, load => load.cargoType)
  loads!:Load[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}