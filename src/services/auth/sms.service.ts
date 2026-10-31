import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomInt } from 'node:crypto';
import { sendSmsIr, smsIrSelected } from 'src/services/common/smsIr';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  /**
   * Sends a one-time code and returns it for verification. SMS_PROVIDER=smsir: our own code in a plain SMS
   * through sms.ir (smsIr.ts). Otherwise Melipayamak, the first that is configured:
   *   MELIPAYAMAK_OTP_BODY_ID  an approved pattern (send/shared), the code its only variable;
   *   MELIPAYAMAK_FROM         a plain SMS from that line (send/simple): our own text, the panel link last;
   *   otherwise                Melipayamak makes the code and sends its own text (send/otp).
   */
  async sendOtp(phoneNumber: string): Promise<string> {
    if (smsIrSelected(this.config)) {
      const code = String(randomInt(10000, 100000));
      const sent = await sendSmsIr(this.http, this.config, phoneNumber, this.otpText(code));
      if (sent.ok) return code;
      this.logger.error(`sms.ir OTP request failed: ${sent.reason}`);
      throw new ServiceUnavailableException('Unable to send verification SMS. Please try again later.');
    }
    const token = this.config.get<string>('MELIPAYAMAK_OTP_TOKEN')?.trim();
    if (!token) {
      throw new ServiceUnavailableException('Registration SMS provider has not been configured.');
    }
    const bodyId = Number(this.config.get<string>('MELIPAYAMAK_OTP_BODY_ID')?.trim());
    if (bodyId > 0) return this.sendPattern(token, bodyId, phoneNumber);
    const from = this.config.get<string>('MELIPAYAMAK_FROM')?.trim();
    // a placeholder left in .env is not a line number
    if (from && /^\+?\d{4,20}$/.test(from)) return this.sendText(token, from, phoneNumber);
    return this.sendGenerated(token, phoneNumber);
  }

  /** a plain-SMS login code: our own text, the panel link last */
  private otpText(code: string): string {
    const panel = this.config.get<string>('WEB_PANEL_URL')?.trim().replace(/\/+$/, '');
    return [`کد ورود به ترابوت: ${code}`, 'این کد را به کسی ندهید.', panel].filter(Boolean).join('\n');
  }

  private async sendText(token: string, from: string, phoneNumber: string): Promise<string> {
    const code = String(randomInt(10000, 100000));
    const text = this.otpText(code);
    try {
      const response = await firstValueFrom(
        this.http.post<{ recId?: number; status?: string }>(
          `https://console.melipayamak.com/api/send/simple/${encodeURIComponent(token)}`,
          { from, to: phoneNumber, text },
          { headers: { 'Content-Type': 'application/json' }, timeout: 10000, maxRedirects: 0 },
        ),
      );
      if (response.status !== 200 || response.data?.status?.trim()) throw new Error('SMS request rejected');
      return code;
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private async sendPattern(token: string, bodyId: number, phoneNumber: string): Promise<string> {
    const code = String(randomInt(10000, 100000));
    try {
      const response = await firstValueFrom(
        this.http.post<{ recId?: number; status?: string }>(
          `https://console.melipayamak.com/api/send/shared/${encodeURIComponent(token)}`,
          { bodyId, to: phoneNumber, args: [code] },
          { headers: { 'Content-Type': 'application/json' }, timeout: 10000, maxRedirects: 0 },
        ),
      );
      if (response.status !== 200 || response.data?.status?.trim() || !response.data?.recId) {
        throw new Error('SMS request rejected');
      }
      return code;
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private async sendGenerated(token: string, phoneNumber: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ code?: string | number; status?: string }>(
          `https://console.melipayamak.com/api/send/otp/${encodeURIComponent(token)}`,
          { to: phoneNumber },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
            maxRedirects: 0,
          },
        ),
      );
      const code = response.data?.code?.toString().trim();
      if (response.status !== 200 || response.data?.status?.trim() || !code || !/^\d{4,10}$/.test(code)) {
        throw new Error('SMS request rejected');
      }
      return code;
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private fail(error: unknown): never {
    // Provider errors include the token and OTP: log only the provider's status text.
    const status = (error as { response?: { status?: number; data?: { status?: unknown } } })?.response;
    this.logger.error(
      `Melipayamak OTP request failed (HTTP ${status?.status ?? 'n/a'}): ${String(status?.data?.status ?? 'no status')}`,
    );
    throw new ServiceUnavailableException('Unable to send verification SMS. Please try again later.');
  }
}
