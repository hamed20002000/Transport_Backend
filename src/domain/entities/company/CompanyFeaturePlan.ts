import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { CompanyFeature } from '../../enums/companyFeature';
import { RecordStatus } from '../../enums/RecordStatus';

/**
 * قیمت یک منو برای durationDays روز. منویی که هیچ پلن فعالی ندارد رایگان است، پس قفل شدن هر منو
 * با تعریف اولین پلنش شروع می‌شود و شرکت‌های فعلی تا آن موقع چیزی از دست نمی‌دهند.
 */
@Entity('CompanyFeaturePlan')
@Index('IDX_CompanyFeaturePlan_feature', ['feature', 'recordStatus'])
export class CompanyFeaturePlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40 })
  feature!: CompanyFeature;

  @Column({ type: 'varchar', length: 150 })
  title!: string;

  @Column({ type: 'int' })
  durationDays!: number;

  @Column({ type: 'bigint' })
  price!: string;

  @Column({ type: 'varchar', length: 10, default: 'IRR' })
  currency!: string;

  @Column({ type: 'smallint', default: RecordStatus.Active })
  recordStatus!: RecordStatus;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
