/** کلید پیام واتساپ (زیرمجموعه‌ی proto.IMessageKey) برای ویرایش یا ری‌اکشن بعدی. */
export interface WhatsappMessageKey {
  remoteJid?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
}
