import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Baileys'in AuthenticationCreds objesini saklar (JSON string olarak).
 * sessionId sabit bir değer olabilir (örn. 'main') ya da çoklu numara
 * desteği isterseniz her WhatsApp numarası için ayrı bir id olabilir.
 */
@Entity('WhatsappAuthCredential')
export class WhatsappAuthCredential {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  sessionId!: string;

  @Column({ type: 'text' })
  credsJson!: string;

  @UpdateDateColumn()
  updatedAt?: Date;
}