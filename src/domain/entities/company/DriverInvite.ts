import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * دعوت شخصی یک راننده از طرف یک شرکت حمل‌ونقل (جدا از دعوت کارخانه و شرکت): شرکت شماره‌ی راننده را می‌دهد (تکی یا
 * چندتایی)، حساب راننده همان لحظه ساخته می‌شود و شرکت به لیست شرکت‌های راننده می‌رود (DriverProfile.companyUserIds)
 * تا بارهایش برای راننده اعلام شود. لینک و کد فقط برای همان شماره کار می‌کنند.
 */
@Entity('DriverInvite')
@Index('IDX_DriverInvite_company', ['companyUserId', 'revokedAt'])
@Index('UQ_DriverInvite_company_driver', ['companyUserId', 'driverUserId'], { unique: true })
export class DriverInvite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token!: string;

  @Column({ type: 'uuid' })
  companyUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyUserId' })
  company!: User;

  /** the invited driver's account, made (or found) with the invite */
  @Column({ type: 'uuid' })
  driverUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driverUserId' })
  driver!: User;

  /** the number the company gave: the only one the link works for */
  @Column({ type: 'varchar', length: 20 })
  mobile!: string;

  /** the invited number first came in, by any way (markInvitesUsed): the invite is done */
  @Column({ type: 'timestamp', nullable: true })
  usedAt?: Date | null;

  /** it came in with this invite itself (its link, or its code in a messenger), not by finding Trabot alone */
  @Column({ type: 'boolean', default: false })
  usedByLink!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
