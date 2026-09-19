import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

import { Customer } from './Customer';
import { CompanyDriver } from './Company';
import { TransportRequest } from '../transport/TransportRequest';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { CompanyUser } from '../auth/CompanyUser';

@Entity('TransportCompany')
export class TransportCompany {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  nationalId?: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  economicCode?: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  registrationNo?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

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

  @Column({ type: 'smallint', default: 0 })
  recordStatus!: RecordStatus;

  @OneToMany(() => Customer, customer => customer.transportCompany)
  customers!: Customer[];

  @OneToMany(
    () => TransportRequest,
    request => request.transportCompany,
  )
  transportRequests!: TransportRequest[];

  @OneToMany(
    () => CompanyDriver,
    companyDriver => companyDriver.company,
  )
  companyDrivers!: CompanyDriver[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(
    () => CompanyUser,
    companyUser => companyUser.transportCompany,
  )
  companyUsers!: CompanyUser[];
}