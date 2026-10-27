import { ConfigService } from '@nestjs/config';

/**
 * An invite code (a factory's «inv_…» or a transport company's «cmp_…») for each messenger: Telegram and Bale open
 * the bot with it («/start <code>»); in Rubika the code is sent to the bot, and WhatsApp's link puts it in the
 * message box. A messenger whose bot name (or WhatsApp number) is not configured is left out; the code itself
 * works in any of them.
 */
export function messengerInvites(config: ConfigService, code: string, label: string) {
  const name = (key: string) => config.get<string>(key)?.trim().replace(/^@/, '') || null;
  const telegram = name('TELEGRAM_BOT_USERNAME');
  const bale = name('BALE_BOT_USERNAME');
  const rubika = name('RUBIKA_BOT_USERNAME');
  // wa.me wants the international number: 0912… → 98912…
  const whatsapp = config.get<string>('WHATSAPP_PHONE')?.replace(/\D/g, '').replace(/^0(?=9)/, '98') || null;
  return {
    code,
    telegram: telegram ? `https://t.me/${telegram}?start=${code}` : null,
    bale: bale ? `https://ble.ir/${bale}?start=${code}` : null,
    rubika: rubika ? `https://rubika.ir/${rubika}` : null,
    whatsapp: whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(`${label}: ${code}`)}` : null,
  };
}
