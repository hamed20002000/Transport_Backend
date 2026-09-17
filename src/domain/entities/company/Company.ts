import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';

import { TransportCompany } from './TransportCompany';
import { Driver } from '../driver/Driver';

@Entity('CompanyDriver')
export class CompanyDriver {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  companyId!: string;

  @Column({ type: 'uuid' })
  driverId!: string;

  @ManyToOne(
    () => TransportCompany,
    company => company.companyDrivers,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'companyId' })
  company!: TransportCompany;

  @ManyToOne(
    () => Driver,
    driver => driver?.companies,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'driverId' })
  driver!: Driver;

  @Column({ type: 'smallint', default: 0 })
  status!: number;

  @CreateDateColumn()
  joinedAt!: Date;
}