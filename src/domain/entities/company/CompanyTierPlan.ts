import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { CompanyFeature, CompanyTier, TierMonths } from '../../enums/companyFeature';

export interface TierOption {
  months: TierMonths;
  price: string;
}
import { RecordStatus } from '../../enums/RecordStatus';

/**
 * طرح برنزی، نقره‌ای یا طلایی: چند بخش پنل شرکت حمل‌ونقل با هم، ۱ ماهه، ۳ ماهه، ۶ ماهه یا ۱ ساله، هر مدت با قیمت خودش.
 * سه ردیف ثابت‌اند (migration)؛ ادمین بخش‌ها و قیمت هر مدت را تعیین و فعال یا غیرفعالش می‌کند؛ مدتی که قیمت ندارد
 * فروخته نمی‌شود. بخشی که در طرح فعالی هست برای شرکت‌هایی
 * که نخریده‌اند قفل است.
 */
@Entity('CompanyTierPlan')
export class CompanyTierPlan {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  tier!: CompanyTier;

  @Column({ type: 'varchar', length: 40, array: true, default: () => "'{}'" })
  features!: CompanyFeature[];

  /** the periods sold, each its price (a decimal string, exact for bigint amounts) */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  options!: TierOption[];

  @Column({ type: 'varchar', length: 10, default: 'IRR' })
  currency!: string;

  @Column({ type: 'smallint', default: RecordStatus.Inactive })
  recordStatus!: RecordStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
