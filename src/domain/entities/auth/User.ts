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

  // the company's names for domestic and for international (export/import) work, each optional: a driver picks
  // the company under the matching kind (DriverKind) when choosing whose loads to receive
  @Column({ type: 'varchar', length: 200, nullable: true })
  domesticCompanyName?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  internationalCompanyName?: string | null;

  // شرکت مادر: همه‌ی منوها بی‌خرید باز است و بارش به همه‌ی رانندگان می‌رسد (فقط ادمین تعیین می‌کند)
  @Column({ type: 'boolean', default: false })
  isParentCompany!: boolean;

  // the parent company whose invite link this transport company signed up with: every menu stays locked until bought
  @Column({ type: 'uuid', nullable: true })
  invitedByCompanyUserId?: string | null;

  // how this user sees loads, on the web and in the messengers: TEXT (the fields) or IMAGE (a picture of the load too)
  @Column({ type: 'varchar', length: 10, default: 'TEXT' })
  cargoDisplay!: 'TEXT' | 'IMAGE';

  // a transport company or factory that signed up on its own is checked by a parent company before it can work
  // (AccountVerificationService): NONE (profile to fill in), PENDING, APPROVED, REJECTED. Everyone else is APPROVED.
  @Column({ type: 'varchar', length: 20, default: 'APPROVED' })
  verificationStatus!: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

  // requests sent so far (the first, then each one after correcting a rejected profile)
  @Column({ type: 'int', default: 0 })
  verificationRequests!: number;

  // the parent company's reason for a rejection
  @Column({ type: 'varchar', length: 500, nullable: true })
  verificationNote?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  verificationRequestedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  verificationDecidedAt?: Date | null;

  // the parent company that approved or rejected
  @Column({ type: 'uuid', nullable: true })
  verificationDecidedBy?: string | null;

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

 
}