import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TransportCompany } from './TransportCompany';
import { TransportRequest } from '../transport/TransportRequest';
import { CustomerType } from '../../enums/company.enum';

@Entity('Customer')
export class Customer {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  transportCompanyId!: string;

  @ManyToOne(
    () => TransportCompany,
    company => company.customers,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'transportCompanyId' })
  transportCompany!: TransportCompany;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /**
   * 0 = Person
   * 1 = Company
   */
  @Column({ type: 'smallint', default: 1 })
  type!: CustomerType;

  @Column({ type: 'varchar', length: 20, nullable: true })
  nationalId?: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  economicCode?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  contactName?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  mobile?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  creditLimit!: number;

  @Column({ type: 'int', default: 0 })
  paymentTermDays!: number;

  @Column({ type: 'smallint', default: 0 })
  recordStatus!: number;

  @OneToMany(
    () => TransportRequest,
    request => request.customer,
  )
  transportRequests!: TransportRequest[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}