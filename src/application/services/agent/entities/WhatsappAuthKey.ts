import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Baileys'in signal key store'unu (pre-key, session, sender-key,
 * app-state-sync-key, app-state-sync-version...) key-value olarak saklar.
 * useMultiFileAuthState her key için ayrı bir dosya yazıyordu;
 * burada aynı mantık DB satırlarıyla karşılanıyor.
 */
@Entity('WhatsappAuthKey')
export class WhatsappAuthKey {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  sessionId: string;

  @PrimaryColumn({ type: 'varchar', length: 100 })
  keyType: string;

  @PrimaryColumn({ type: 'varchar', length: 200 })
  keyId: string;

  @Column({ type: 'text' })
  valueJson: string;

  @UpdateDateColumn()
  updatedAt: Date;
}