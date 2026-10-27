import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';

import { User } from '../auth/User';

/** شرکت حمل‌ونقلی که کارخانه از آن لینک دعوت گرفته؛ کارخانه بارش را برای یکی از همین‌ها می‌فرستد. */
@Entity('FactoryCompany')
@Unique('UQ_FactoryCompany_factory_company', ['factoryUserId', 'companyUserId'])
@Index('IDX_FactoryCompany_company', ['companyUserId'])
export class FactoryCompany {
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

  @CreateDateColumn()
  createdAt!: Date;
}
