/**
 * قرارداد پیام‌هایی که tarabari_backend روی RabbitMQ منتشر می‌کند
 * (OutboxService -> exchange cargo_events). هر تغییری در payload آنجا
 * باید اینجا هم اعمال شود.
 */
export const CARGO_EVENTS_EXCHANGE = 'cargo_events';

export const CARGO_MESSAGE_DETECTED = 'cargo.message.detected';

export const CARGO_NOTIFICATION_QUEUE = 'transport.cargo-notifications';

// پیام‌های خراب یا پیام‌هایی که دو بار پشت سر هم fail شده‌اند اینجا
// می‌مانند تا بررسی شوند و صف اصلی گیر نکند.
export const CARGO_NOTIFICATION_DLQ = `${CARGO_NOTIFICATION_QUEUE}.dlq`;

export interface CargoDetectedEvent {
  messageId: string;
  // کد پیگیری بار (مثل TRB100000)؛ رویدادهای قدیمی ندارند.
  code?: string;
  isVoice?: boolean;
  rawText: string;
  receivedAt: string;
  origin: string | null;
  destination: string | null;
  cargoType: string | null;
  weight: string | null;
  vehicleType: string | null;
  price: string | null;
  extraNotes: string | null;
  processedText: string | null;
  ownerUserIds: string[];
  // فیلدهای مخصوص پلتفرم (مثلاً chatId/groupId) که tarabari اضافه می‌کند.
  [key: string]: unknown;
}
