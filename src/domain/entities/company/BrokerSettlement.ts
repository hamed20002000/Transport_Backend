import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A payment a transport company made to a broker against what it owes it (its commission on the broker's delivered
 * trips, CargoRequest.brokerCommission): what is left is the commission less these (BrokerLedgerService).
 */
@Entity('BrokerSettlement')
@Index('IDX_BrokerSettlement_company_broker', ['companyUserId', 'brokerUserId'])
export class BrokerSettlement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  companyUserId!: string;

  @Column({ type: 'uuid' })
  brokerUserId!: string;

  // a decimal string keeps the bigint exact across JSON and JavaScript
  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
