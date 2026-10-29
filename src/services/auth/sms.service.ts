import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomInt } from 'node:crypto';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  /**
   * Sends a one-time code and returns it for verification. With MELIPAYAMAK_OTP_BODY_ID (the approved pattern) the
   * code is made here and goes in that pattern (send/shared, the code is its only variable); without it Melipayamak
   * makes the code and sends its own text (send/otp).
   */
  async sendOtp(phoneNumber: string): Promise<string> {
    const token = this.config.get<string>('MELIPAYAMAK_OTP_TOKEN')?.trim();
    if (!token) {
      throw new ServiceUnavailableException('Registration SMS provider has not been configured.');
    }
    const bodyId = Number(this.config.get<string>('MELIPAYAMAK_OTP_BODY_ID')?.trim());
    return bodyId > 0 ? this.sendPattern(token, bodyId, phoneNumber) : this.sendGenerated(token, phoneNumber);
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
