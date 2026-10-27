import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../auth/User';

/**
 * باری که کارخانه برای یک شرکت حمل‌ونقل فرستاده؛ در «پیشنهادها»ی همان شرکت می‌نشیند
 * (CargoNotification با sourceMessageId = factory:<id>) و شرکت مثل بار کانال‌ها اعلامش می‌کند.
 */
@Entity('FactoryCargo')
@Index('IDX_FactoryCargo_factory', ['factoryUserId', 'createdAt'])
export class FactoryCargo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  factoryUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'factoryUserId' })
  factory!: User;

  @Column({ type: 'uuid' })
  companyUserId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyUserId' })
  company!: User;

  @Column({ type: 'varchar', length: 200 })
  origin!: string;

  @Column({ type: 'varchar', length: 200 })
  destination!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  cargoType?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  weight?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  vehicleType?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  price?: string | null;

  @Column({ type: 'text', nullable: true })
  extraNotes?: string | null;

  // the photo the company (or factory) put on the load, in CARGO_PHOTO_DIR; none: a picture made from its kind of cargo
  @Column({ type: 'varchar', length: 64, nullable: true })
  photo?: string | null;

  @Column('varchar', { array: true, default: () => "'{}'" })
  contactPhones!: string[];

  @CreateDateColumn()
  createdAt!: Date;
}
