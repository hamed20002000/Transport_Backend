import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RecordStatus } from '../../enums/RecordStatus';
import { UserRole } from './UserRole';
import { CompanyUser } from './CompanyUser';
import { Driver } from '../driver/Driver';

@Entity('User')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'varchar',
    length: 100,
    unique: true,
  })
  username!: string;

  @Column({
    type: 'varchar',
    length: 255,
  })
  passwordHash!: string;

  @Column({
    type: 'varchar',
    length: 150,
    nullable: true,
    unique: true,
  })
  email?: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    unique: true,
  })
  mobile?: string;

  @Column({
    type: 'smallint',
    default: RecordStatus.Active,
  })
  recordStatus!: RecordStatus;

  @OneToMany(
    () => UserRole,
    userRole => userRole.user,
  )
  userRoles!: UserRole[];

  @OneToMany(
    () => CompanyUser,
    companyUser => companyUser.user,
  )
  companyUsers!: CompanyUser[];

  @OneToOne(
    () => Driver,
    driver => driver.user,
  )
  driver?: Driver;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}