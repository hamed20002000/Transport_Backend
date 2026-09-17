import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { Settlement } from './Settlement';

@Entity('Payment')
@Index(['settlementId', 'status'])
@Index(['paidAt'])
export class Payment {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
  })
  settlementId!: string;

  @ManyToOne(
    () => Settlement,
    settlement => settlement.payments,
    {
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'settlementId' })
  settlement!: Settlement;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  amount!: number;

  @Column({
    type: 'smallint',
  })
  paymentMethod!: number;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  referenceNumber?: string;

  @Column({
    type: 'timestamp',
    nullable: true,
  })
  paidAt?: Date;

  @Column({
    type: 'smallint',
    default: 0,
  })
  status!: number;

  @Column({
    type: 'text',
    nullable: true,
  })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;
}