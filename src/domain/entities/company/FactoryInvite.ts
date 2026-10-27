import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * دعوت شخصی یک کارخانه از طرف یک شرکت حمل‌ونقل: شرکت شماره‌ی کارخانه را می‌دهد، حساب کارخانه همان لحظه ساخته
 * می‌شود و به لیست کارخانه‌های شرکت می‌رود (FactoryCompany). لینک و کد فقط برای همان شماره کار می‌کنند. با حذف
 * کارخانه از لیست، دعوت باطل می‌شود (revokedAt).
 */
@Entity('FactoryInvite')
@Index('IDX_FactoryInvite_company', ['companyUserId', 'revokedAt'])
@Index('UQ_FactoryInvite_company_factory', ['companyUserId', 'factoryUserId'], { unique: true })
export class FactoryInvite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token!: string;

  @Column({ type: 'uuid' })
  companyUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyUserId' })
  company!: User;

  /** the invited factory's account, made (or found) with the invite */
  @Column({ type: 'uuid' })
  factoryUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'factoryUserId' })
  factory!: User;

  /** the number the company gave: the only one the link works for */
  @Column({ type: 'varchar', length: 20 })
  mobile!: string;

  /** the factory first came in with the link (web, a bot or WhatsApp) */
  @Column({ type: 'timestamp', nullable: true })
  usedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
