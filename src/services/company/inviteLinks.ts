import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

export interface MessengerInvites {
  code: string;
  telegram: string | null;
  bale: string | null;
  eitaa: string | null;
  rubika: string | null;
  whatsapp: string | null;
}

/**
 * An invite code (a factory's «inv_…», a driver's «drv_…» or a transport company's «cmp_…») for each messenger:
 * Telegram and Bale open the bot with it («/start <code>»), WhatsApp's link puts it in the message box, Eitaa and
 * Rubika only open the bot's chat (the invited number signs in there all the same, its account is made beforehand).
 * A messenger whose bot name (or WhatsApp number) is not configured is left out.
 */
export function messengerInvites(config: ConfigService, code: string): MessengerInvites {
  const name = (key: string) => config.get<string>(key)?.trim().replace(/^@/, '') || null;
  const telegram = name('TELEGRAM_BOT_USERNAME');
  const bale = name('BALE_BOT_USERNAME');
  const eitaa = name('EITAA_BOT_USERNAME');
  const rubika = name('RUBIKA_BOT_USERNAME');
  // wa.me wants the international number: 0912… → 98912…
  const whatsapp = config.get<string>('WHATSAPP_PHONE')?.replace(/\D/g, '').replace(/^0(?=9)/, '98') || null;
  return {
    code,
    telegram: telegram ? `https://t.me/${telegram}?start=${code}` : null,
    bale: bale ? `https://ble.ir/${bale}?start=${code}` : null,
    eitaa: eitaa ? `https://eitaa.com/${eitaa}` : null,
    rubika: rubika ? `https://rubika.ir/${rubika}` : null,
    whatsapp: whatsapp ? `https://wa.me/${whatsapp}?text=${code}` : null,
  };
}

/**
 * The invite SMS (and the panel's «ارسال»): who invites and only the web link. The link opens sign-in, which shows
 * the messenger links of the same invite (the invite info endpoints carry them), so the SMS stays short.
 */
export function inviteText(webLink: string, inviter: string): string {
  return `لینک دعوت «${inviter}»:\n${webLink}`;
}

/**
 * An invite's token: 16 characters (96 random bits), so the link's short path (d/…, 18 characters) fits a template
 * variable of sms.ir (25 at most). Tokens of 16 to 64 characters are read (older ones were 24).
 */
export function inviteToken(): string {
  return randomBytes(12).toString('base64url');
}
