import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import { sendSmsIr, smsIrSelected } from 'src/services/common/smsIr';
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
 * پیامک دعوت (راننده، کارخانه، شرکت) با ملی‌پیامک: هر شماره لینک وب شخصی خودش را می‌گیرد؛ لینک ربات‌ها در صفحه‌ی
 * ورودی است که همان لینک باز می‌کند. دعوت چندتایی هم شماره‌به‌شماره فرستاده می‌شود. فقط وقتی SMS_OTP_ENABLED=true
 * است ارسال می‌شود؛ وگرنه متن در لاگ می‌آید. خطای ارسال دعوت را خراب نمی‌کند.
 *
 * با MELIPAYAMAK_INVITE_BODY_ID (الگوی تأییدشده، send/shared): دامنه در متن خود الگو ثابت است و لینک آخر متن است،
 * مثلاً «{0} شما را به ترابوت دعوت کرده است:\nhttps://trabot.ir/{1}»؛ {0} دعوت‌کننده و {1} مسیر لینک
 * (مثلاً join/…). بی آن، متن آزاد (send/simple) با MELIPAYAMAK_FROM.
 *
 * با SMS_PROVIDER=smsir همه‌ی دعوت‌ها متن آزاد از sms.ir می‌روند (smsIr.ts) و الگوی ملی‌پیامک کنار می‌رود.
 *
 * تنظیمات: WEB_PANEL_URL (آدرس پنل وب، مثلاً https://trabot.ir)، MELIPAYAMAK_CONSOLE_KEY (کلید API کنسول؛ اگر
 * نباشد همان MELIPAYAMAK_OTP_TOKEN).
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
    const bodyId = Number(this.config.get<string>('MELIPAYAMAK_INVITE_BODY_ID')?.trim());
    if (bodyId > 0 && !smsIrSelected(this.config)) return this.sendPattern(mobile, bodyId, [inviter, webPath.replace(/^\/+/, '')], inviteText(`${panel}${webPath}`, inviter));
    return this.sendOne(mobile, inviteText(`${panel}${webPath}`, inviter));
  }

  /** One number through an approved pattern (send/shared); text: what it reads like, for the log while SMS is off. */
  private async sendPattern(to: string, bodyId: number, args: string[], text: string): Promise<InviteSmsResult> {
    return this.post(to, text, 'shared', { bodyId, to, args });
  }

  /** One number, one text (send/simple). */
  async sendOne(to: string, text: string): Promise<InviteSmsResult> {
    const from = this.config.get<string>('MELIPAYAMAK_FROM')?.trim();
    // a placeholder left in .env is not a line number
    return this.post(to, text, 'simple', from && /^\+?\d{4,20}$/.test(from) ? { from, to, text } : null);
  }

  /** body null: not configured (no sender line). */
  private async post(to: string, text: string, api: 'simple' | 'shared', body: object | null): Promise<InviteSmsResult> {
    const count = 1;
    if (this.config.get<string>('SMS_OTP_ENABLED')?.trim().toLowerCase() !== 'true') {
      this.logger.log(`Invite SMS is off; would send to ${to}: ${text}`);
      return { status: 'off', count };
    }
    if (smsIrSelected(this.config)) {
      const sent = await sendSmsIr(this.http, this.config, to, text);
      if (sent.ok) return { status: 'sent', count };
      this.logger[sent.notConfigured ? 'warn' : 'error'](`Invite SMS via sms.ir not sent: ${sent.reason}`);
      return { status: sent.notConfigured ? 'notConfigured' : 'failed', count };
    }
    // a console key that is empty or a placeholder falls back to the OTP token (the same console key)
    const consoleKey = this.config.get<string>('MELIPAYAMAK_CONSOLE_KEY')?.trim();
    const key = consoleKey && /^[0-9a-fA-F-]{16,}$/.test(consoleKey) ? consoleKey : this.config.get<string>('MELIPAYAMAK_OTP_TOKEN')?.trim();
    if (!key || !body) {
      this.logger.warn('Invite SMS not sent: MELIPAYAMAK_FROM or the console API key is not configured.');
      return { status: 'notConfigured', count };
    }
    try {
      const response = await firstValueFrom(
        this.http.post<{ status?: string }>(
          `https://console.melipayamak.com/api/send/${api}/${encodeURIComponent(key)}`,
          body,
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
