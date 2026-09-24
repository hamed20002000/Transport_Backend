import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class SmsService {
  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    const apiKey = this.config.get<string>('KAVENEGAR_API_KEY')?.trim();
    const template = this.config.get<string>('KAVENEGAR_OTP_TEMPLATE')?.trim();
    if (!apiKey || !template) {
      throw new ServiceUnavailableException('Registration SMS provider has not been configured.');
    }
    try {
      const response = await firstValueFrom(
        this.http.post<{ return?: { status?: number } }>(
          `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/verify/lookup.json`,
          new URLSearchParams({ receptor: phoneNumber, token: code, template, type: 'sms' }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000,
            maxRedirects: 0,
          },
        ),
      );
      if (response.status !== 200 || response.data?.return?.status !== 200) {
        throw new Error('SMS request rejected');
      }
    } catch {
      // Provider errors include the API key and OTP: do not log or expose them.
      throw new ServiceUnavailableException('Unable to send verification SMS. Please try again later.');
    }
  }
}
