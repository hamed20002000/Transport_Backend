import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Vehicle } from './Vehicle';
import { Load } from '../transport/Load';

@Entity('VehicleType')
export class VehicleType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 100,
  })
  title!: string;

  @Column({
    type: 'varchar',
    length: 50,
    unique: true,
  })
  code!: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  defaultCapacityKg?: number;

  @Column({
    type: 'smallint',
    default: 0,
  })
  recordStatus!: number;

  @OneToMany(() => Vehicle, vehicle => vehicle.vehicleType)
  vehicles!: Vehicle[];

  @OneToMany(() => Load, load => load.requiredVehicleType)
  loads!: Load[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}