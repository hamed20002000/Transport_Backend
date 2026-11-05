import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * A mobile number that signs in to the parent company (User.isParentCompany) instead of an account of its own: the
 * people who work the parent company's panel. Any number of them may be signed in at once (the parent company is
 * exempt from one-session-at-a-time, SessionService); an account of the number's own is left as it is, unused on
 * the web while the number is here.
 */
@Entity('ParentCompanyLogin')
export class ParentCompanyLogin {
  /** normalized, 09xxxxxxxxx */
  @PrimaryColumn({ type: 'varchar', length: 11 })
  mobile!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  note?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
