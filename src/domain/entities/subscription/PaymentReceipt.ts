import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { SubscriptionOrder } from './SubscriptionOrder';
import { PaymentReceiptStatus } from 'src/domain/enums/subscription';

@Entity('PaymentReceipt')
export class PaymentReceipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
  })
  orderId!: string;

  @ManyToOne(
    () => SubscriptionOrder,
    order => order.receipts,
    {
      nullable: false,
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({
    name: 'orderId',
  })
  order!: SubscriptionOrder;

  /*
   * Telegram fileId / WhatsApp mediaId
   */
  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  providerFileId?: string;

  /*
   * آدرس ذخیره‌شده عکس در CDN/Object Storage
   */
  @Column({
    type: 'text',
  })
  imageUrl!: string;

  @Column({
    type: 'enum',
    enum: PaymentReceiptStatus,
    default: PaymentReceiptStatus.PendingAnalysis,
  })
  status!: PaymentReceiptStatus;

  @Column({
    type: 'int',
    default: 0,
  })
  analysisAttempts!: number;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  analysisStartedAt?: Date;

  // --------------------------
  // AI extracted data
  // --------------------------

  @Column({
    type: 'bigint',
    nullable: true,
  })
  extractedAmount?: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  trackingCode?: string;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  transactionDate?: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  transactionTime?: string;

  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  sourceCard?: string;

  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  destinationCard?: string;

  @Column({
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  destinationName?: string;

  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  extractedPaymentStatus?: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 4,
    nullable: true,
  })
  aiConfidence?: number;

  @Column({
    type: 'boolean',
    nullable: true,
  })
  amountMatched?: boolean;

  @Column({
    type: 'boolean',
    nullable: true,
  })
  destinationCardMatched?: boolean;

  @Column({
    type: 'boolean',
    nullable: true,
  })
  destinationNameMatched?: boolean;

  @Column({
    type: 'boolean',
    nullable: true,
  })
  duplicateTrackingCode?: boolean;

  /*
   * JSON کامل خروجی AI را هم نگه می‌داریم
   * برای Debug و بهبود مدل در آینده.
   */
  @Column({
    type: 'jsonb',
    nullable: true,
  })
  aiRawResult?: Record<string, unknown>;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  analyzedAt?: Date;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  reviewedByUserId?: string;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  reviewedAt?: Date;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  reviewNote?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}