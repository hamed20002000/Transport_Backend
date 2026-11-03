import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * دعوت شخصی یک واسط از طرف یک شرکت حمل‌ونقل (مثل دعوت کارخانه): شرکت شماره‌ی واسط را می‌دهد و حساب واسط همان لحظه
 * ساخته می‌شود؛ وقتی ادمین تعداد شرکت‌های واسط را محدود کرده، شرکت دعوت‌کننده جزو شرکت‌های انتخابی‌اش می‌شود. لینک و
 * کد فقط برای همان شماره کار می‌کنند. با حذف واسط از لیست شرکت، دعوت باطل می‌شود (revokedAt).
 */
@Entity('BrokerInvite')
@Index('IDX_BrokerInvite_company', ['companyUserId', 'revokedAt'])
@Index('UQ_BrokerInvite_company_broker', ['companyUserId', 'brokerUserId'], { unique: true })
// markInvitesUsed and invitedAccountTypes look an invite up by its number at every sign-in
@Index('IDX_BrokerInvite_mobile', ['mobile'])
export class BrokerInvite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token!: string;

  @Column({ type: 'uuid' })
  companyUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyUserId' })
  company!: User;

  /** the invited broker's account, made (or found) with the invite */
  @Column({ type: 'uuid' })
  brokerUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brokerUserId' })
  broker!: User;

  /** the number the company gave: the only one the link works for */
  @Column({ type: 'varchar', length: 20 })
  mobile!: string;

  /** the broker first came in with the link (web, a bot or WhatsApp) */
  @Column({ type: 'timestamp', nullable: true })
  usedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
