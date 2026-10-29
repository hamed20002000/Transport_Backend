import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import { inviteText } from './inviteLinks';

/** what happened to the invite SMS, shown to the inviting company */
export type InviteSmsStatus =
  /** sent to the provider */
  | 'sent'
  /** SMS is off (SMS_OTP_ENABLED is not true, e.g. development): only logged */
  | 'off'
  /** the panel address, sender line or API key is not configured */
  | 'notConfigured'
  | 'failed';

export interface InviteSmsResult {
  status: InviteSmsStatus;
  /** the numbers it went (or would have gone) to */
  count: number;
}

/**
 * پیامک دعوت (راننده، کارخانه، شرکت) با ملی‌پیامک (send/simple): هر شماره لینک وب شخصی خودش را می‌گیرد (inviteText)؛
 * لینک ربات‌ها در صفحه‌ی ورودی است که همان لینک باز می‌کند. دعوت چندتایی هم شماره‌به‌شماره فرستاده می‌شود.
 * فقط وقتی SMS_OTP_ENABLED=true است ارسال می‌شود؛ وگرنه متن در لاگ می‌آید. خطای ارسال دعوت را خراب نمی‌کند.
 *
 * تنظیمات: WEB_PANEL_URL (آدرس پنل وب، مثلاً https://trabot.ir)، MELIPAYAMAK_FROM (خط فرستنده) و
 * MELIPAYAMAK_CONSOLE_KEY (کلید API کنسول؛ اگر نباشد همان MELIPAYAMAK_OTP_TOKEN).
 */
@Injectable()
export class InviteSmsService {
  private readonly logger = new Logger(InviteSmsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  /** The web panel address for links in the SMS, or null when not configured. */
  panelUrl(): string | null {
    return this.config.get<string>('WEB_PANEL_URL')?.trim().replace(/\/+$/, '') || null;
  }

  /** One invite from inviter (the inviting company's name): its web link (panel path + token). */
  async sendInvite(mobile: string, webPath: string, inviter: string): Promise<InviteSmsResult> {
    const panel = this.panelUrl();
    if (!panel) return { status: 'notConfigured', count: 1 };
    return this.sendOne(mobile, inviteText(`${panel}${webPath}`, inviter));
  }

  /** One number, one text. */
  async sendOne(to: string, text: string): Promise<InviteSmsResult> {
    const count = 1;
    if (this.config.get<string>('SMS_OTP_ENABLED')?.trim().toLowerCase() !== 'true') {
      this.logger.log(`Invite SMS is off; would send to ${to}: ${text}`);
      return { status: 'off', count };
    }
    const key = (this.config.get<string>('MELIPAYAMAK_CONSOLE_KEY') ?? this.config.get<string>('MELIPAYAMAK_OTP_TOKEN'))?.trim();
    const from = this.config.get<string>('MELIPAYAMAK_FROM')?.trim();
    if (!key || !from) {
      this.logger.warn('Invite SMS not sent: MELIPAYAMAK_FROM or the console API key is not configured.');
      return { status: 'notConfigured', count };
    }
    try {
      const response = await firstValueFrom(
        this.http.post<{ status?: string }>(
          `https://console.melipayamak.com/api/send/simple/${encodeURIComponent(key)}`,
          { from, to, text },
          { headers: { 'Content-Type': 'application/json' }, timeout: 15000, maxRedirects: 0 },
        ),
      );
      // like the OTP call: an empty status is success, any text is the provider's reason
      if (response.status !== 200 || response.data?.status?.trim()) throw new Error(response.data?.status ?? 'rejected');
      return { status: 'sent', count };
    } catch (error) {
      // the URL holds the API key: log only the provider's status text
      const failure = (error as { response?: { status?: number; data?: { status?: unknown } } })?.response;
      this.logger.error(`Invite SMS failed (HTTP ${failure?.status ?? 'n/a'}): ${String(failure?.data?.status ?? (error as Error).message)}`);
      return { status: 'failed', count };
    }
  }
}
