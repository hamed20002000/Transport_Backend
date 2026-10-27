import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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

// the provider's limit for one «advanced» send is not documented here: big batches go in parts of this size
const GROUP_PART = 100;

/**
 * پیامک دعوت (راننده، کارخانه، شرکت) با ملی‌پیامک: یک شماره با send/simple (لینک شخصی همان دعوت) و چند شماره یک‌جا
 * با send/advanced (یک متن برای همه؛ لینک ورود عمومی، چون حساب هر کس از قبل با شماره‌اش ساخته شده).
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

  /** One number: its own text (with its personal link). */
  async sendOne(mobile: string, text: string): Promise<InviteSmsResult> {
    return this.send('simple', [mobile], text);
  }

  /** Several numbers at once: one text for all of them. */
  async sendGroup(mobiles: string[], text: string): Promise<InviteSmsResult> {
    if (mobiles.length === 1) return this.sendOne(mobiles[0], text);
    let failed = false;
    for (let i = 0; i < mobiles.length; i += GROUP_PART) {
      const part = await this.send('advanced', mobiles.slice(i, i + GROUP_PART), text);
      if (part.status !== 'sent') {
        if (part.status !== 'failed') return { status: part.status, count: mobiles.length };
        failed = true;
      }
    }
    return { status: failed ? 'failed' : 'sent', count: mobiles.length };
  }

  private async send(method: 'simple' | 'advanced', to: string[], text: string): Promise<InviteSmsResult> {
    const count = to.length;
    if (!count) return { status: 'sent', count };
    if (this.config.get<string>('SMS_OTP_ENABLED')?.trim().toLowerCase() !== 'true') {
      this.logger.log(`Invite SMS is off; would send to ${count} number(s): ${text}`);
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
          `https://console.melipayamak.com/api/send/${method}/${encodeURIComponent(key)}`,
          { from, to: method === 'simple' ? to[0] : to, text },
          { headers: { 'Content-Type': 'application/json' }, timeout: 15000, maxRedirects: 0 },
        ),
      );
      // like the OTP call: an empty status is success, any text is the provider's reason
      if (response.status !== 200 || response.data?.status?.trim()) throw new Error(response.data?.status ?? 'rejected');
      return { status: 'sent', count };
    } catch (error) {
      // the URL holds the API key: log only the provider's status text
      const failure = (error as { response?: { status?: number; data?: { status?: unknown } } })?.response;
      this.logger.error(`Invite SMS (${method}, ${count} number(s)) failed (HTTP ${failure?.status ?? 'n/a'}): ${String(failure?.data?.status ?? (error as Error).message)}`);
      return { status: 'failed', count };
    }
  }
}
