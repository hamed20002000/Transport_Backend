import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * userid + username (sistemdeki iki ayrı alan) ile WhatsApp jid'i (numara)
 * arasındaki eşleme. Telegram tarafındaki TelegramService.getChatIdForUsername'in
 * WhatsApp karşılığı.
 */
@Entity('WhatsappUserMapping')
export class WhatsappUserMapping {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  userid!: string;

  @Column({ type: 'varchar', length: 100 })
  username!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  jid!: string;

  // جدید: session جاری این کاربر -- تا وقتی که خالی نشه (یا کاربر دستوری
  // برای شروع چت جدید نده)، همه‌ی پیام‌ها به همین session وصل می‌مونن؛
  // دقیقاً معادل رفتار فرانت‌اند وب که یک sessionId رو تا "چت جدید" نگه
  // می‌داره.
  @Column({ type: 'varchar', length: 100, nullable: true })
  CurrentSessionId!: string | null;
}