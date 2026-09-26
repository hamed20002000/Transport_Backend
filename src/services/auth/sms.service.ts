import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  /** Melipayamak generates and sends the one-time code itself; the sent code is returned for verification. */
  async sendOtp(phoneNumber: string): Promise<string> {
    const token = this.config.get<string>('MELIPAYAMAK_OTP_TOKEN')?.trim();
    if (!token) {
      throw new ServiceUnavailableException('Registration SMS provider has not been configured.');
    }
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
      // Provider errors include the token and OTP: log only the provider's status text.
      const status = (error as { response?: { status?: number; data?: { status?: unknown } } })?.response;
      this.logger.error(
        `Melipayamak OTP request failed (HTTP ${status?.status ?? 'n/a'}): ${String(status?.data?.status ?? 'no status')}`,
      );
      throw new ServiceUnavailableException('Unable to send verification SMS. Please try again later.');
    }
  }
}
