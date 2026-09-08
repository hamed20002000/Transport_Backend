import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * userid + username (sistemdeki iki ayrı alan) ile WhatsApp jid'i (numara)
 * arasındaki eşleme. Telegram tarafındaki TelegramService.getChatIdForUsername'in
 * WhatsApp karşılığı.
 */
@Entity('WhatsappUserMapping')
export class WhatsappUserMapping {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  userid: string;

  @Column({ type: 'varchar', length: 100 })
  username: string;

  @Column({ type: 'varchar', length: 100 })
  jid: string;
}