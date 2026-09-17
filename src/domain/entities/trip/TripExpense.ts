import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { Trip } from './Trip';
import { TripExpenseType } from '../../enums/trip.enum';

@Entity('TripExpense')
@Index(['tripId', 'expenseType'])
export class TripExpense {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tripId!: string;

  @ManyToOne(
    () => Trip,
    trip => trip.expenses,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({ name: 'tripId' })
  trip!: Trip;

@Column({
  type: 'smallint',
})
expenseType!: TripExpenseType;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  amount!: number;

  @Column({
    type: 'text',
    nullable: true,
  })
  description?: string;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  receiptUrl?: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  latitude?: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 7,
    nullable: true,
  })
  longitude?: number;

  @CreateDateColumn()
  createdAt!: Date;
}