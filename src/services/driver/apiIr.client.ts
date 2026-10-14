import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const DEFAULT_BASE_URL = 'https://s.api.ir/api/sw1';

/** پاسخ همه‌ی سرویس‌های api.ir؛ success=false یعنی استعلام انجام شد ولی رد شد. */
export interface ApiIrResult<T> {
  success: boolean;
  code?: number;
  message?: string | null;
  data?: T | null;
}

export interface PersonInfo {
  nationalCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fatherName?: string | null;
  gender?: number | null;
  alive?: boolean | null;
}

export interface DrivingLicenseInfo {
  nationalCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  licenseNumber?: string | null;
  licenseStatus?: string | null;
  licenseType?: string | null;
  issueDate?: string | null;
  validityYears?: string | null;
}

export interface DrivingScoreInfo {
  licenseNumber?: string | null;
  negativeScore?: number | null;
  offenseCount?: number | null;
  rule?: string | null;
}

/**
 * استعلام‌های پولی api.ir (مستندات: https://s.api.ir/swagger/index.html).
 * کلید در API_IR_TOKEN، در هدر Authorization: Bearer.
 */
@Injectable()
export class ApiIrClient {
  private readonly logger = new Logger(ApiIrClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  /** تطبیق کد ملی با موبایل؛ data=true یعنی سیم‌کارت به نام همین کد ملی است. */
  shahkar(nationalCode: string, mobile: string) {
    return this.post<boolean>('Shahkar', { nationalCode, mobile, isCompany: false });
  }

  /** مشخصات ثبت احوال؛ birthDate شمسی به شکل 1370/1/1 */
  personInfo(nationalCode: string, birthDate: string) {
    return this.post<PersonInfo>('PersonInfo', { nationalCode, birthDate });
  }

  drivingLicense(nationalCode: string, mobile: string) {
    return this.post<{ licenses?: DrivingLicenseInfo[] | null }>('DrivingLicense', { nationalCode, mobile });
  }

  drivingScore(nationalCode: string, mobile: string, licenseNumber: string) {
    return this.post<DrivingScoreInfo>('DrivingScore', { nationalCode, mobile, licenseNumber });
  }

  private async post<T>(service: string, body: Record<string, unknown>): Promise<ApiIrResult<T>> {
    // کلید کپی‌شده از پنل گاهی «Bearer» را هم با خودش دارد
    const token = this.config.get<string>('API_IR_TOKEN')?.trim().replace(/^Bearer\s*/i, '');
    if (!token) throw new ServiceUnavailableException('Identity inquiry provider has not been configured.');
    const baseUrl = this.config.get<string>('API_IR_BASE_URL')?.trim() || DEFAULT_BASE_URL;
    try {
      const response = await firstValueFrom(
        this.http.post<ApiIrResult<T>>(`${baseUrl}/${service}`, body, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 30000,
          maxRedirects: 0,
        }),
      );
      if (typeof response.data?.success !== 'boolean') throw new Error('Malformed response');
      return response.data;
    } catch (error: unknown) {
      const response = (error as { response?: { status?: number; data?: ApiIrResult<T> } })?.response;
      // ورودی نادرست یا پیدا نشدن (400/404) نتیجه‌ی خود استعلام است؛ 401/402/403/429/5xx یعنی کلید، اعتبار یا خود سرویس.
      if ((response?.status === 400 || response?.status === 404) && typeof response.data?.success === 'boolean') {
        return response.data;
      }
      // ورودی‌ها اطلاعات شخصی‌اند: فقط وضعیت و پیام سرویس لاگ می‌شود.
      this.logger.error(`api.ir ${service} failed (HTTP ${response?.status ?? 'n/a'}): ${String(response?.data?.message ?? (error as Error)?.message)}`);
      throw new ServiceUnavailableException('Identity inquiry service is unavailable. Please try again later.');
    }
  }
}
