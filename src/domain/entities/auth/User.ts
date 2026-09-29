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
import { CustomerType } from '../../enums/company.enum';
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

  // اطلاعات پروفایل (شخصی/شرکتی) همه اختیاری‌اند؛ کاربر بعد از ثبت‌نام تکمیل یا اصلاحشان می‌کند.
  @Column({ type: 'smallint', nullable: true })
  profileType?: CustomerType | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firstName?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastName?: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  nationalCode?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  companyName?: string | null;

  @Column({ type: 'varchar', length: 11, nullable: true })
  companyNationalId?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  economicCode?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  registrationNo?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  postalCode?: string | null;

  @Column({ type: 'text', nullable: true })
  address?: string | null;

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

 

@Column({
  type: 'boolean',
  default: false,
})
mustChangePassword!: boolean;
}