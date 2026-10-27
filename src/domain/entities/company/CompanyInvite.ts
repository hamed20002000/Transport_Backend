import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * دعوت شخصی یک شرکت حمل‌ونقل غیرمادر از طرف شرکت مادر (جدا از لینک کارخانه، FactoryInvite). شرکت مادر شماره‌ی
 * شرکت را می‌دهد و حساب شرکت همان لحظه ساخته می‌شود (User.invitedByCompanyUserId: همه‌ی بخش‌ها تا خرید قفل)؛ لینک
 * و کد فقط برای همان شماره کار می‌کنند و شرکت با آن شماره وارد وب یا پیام‌رسان‌ها می‌شود.
 */
@Entity('CompanyInvite')
@Index('IDX_CompanyInvite_parent', ['parentUserId', 'revokedAt'])
export class CompanyInvite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token!: string;

  @Column({ type: 'uuid' })
  parentUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parentUserId' })
  parent!: User;

  /** the invited company's account, made with the invite */
  @Index('UQ_CompanyInvite_company', { unique: true })
  @Column({ type: 'uuid' })
  companyUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyUserId' })
  company!: User;

  /** the number the parent company gave: the only one the link works for */
  @Column({ type: 'varchar', length: 20 })
  mobile!: string;

  /** the company first came in with the link (web, a bot or WhatsApp) */
  @Column({ type: 'timestamp', nullable: true })
  usedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
