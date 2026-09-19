import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { User } from './User';
import { TransportCompany } from '../company/TransportCompany';
import { RecordStatus } from '../../enums/RecordStatus';

@Entity('CompanyUser')
@Unique(['userId', 'transportCompanyId'])
@Index(['transportCompanyId', 'recordStatus'])
@Index(['userId'])
export class CompanyUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @ManyToOne(
    () => User,
    user => user.companyUsers,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column('uuid')
  transportCompanyId!: string;

  @ManyToOne(
    () => TransportCompany,
    company => company.companyUsers,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'transportCompanyId' })
  transportCompany!: TransportCompany;

  @Column({
    type: 'smallint',
    default: RecordStatus.Active,
  })
  recordStatus!: RecordStatus;

  @CreateDateColumn()
  createdAt!: Date;
}