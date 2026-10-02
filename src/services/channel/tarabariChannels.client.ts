import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

import type { ChannelPlatform } from '../../domain/constants/channelEvents';

export type { ChannelPlatform };

/** ChannelView در tarabari_backend (channelRegistry.service.ts). */
export interface MonitoredChannel {
  id: string;
  platform: ChannelPlatform;
  identifier: string | null;
  type: 'group' | 'channel' | null;
  label: string | null;
  isActive: boolean;
  isMember: boolean;
  joinRequestPending: boolean;
  lastError: string | null;
  ownerUserIds: string[];
  createdAt: string;
}

export type ChannelErrorKind = 'invalid' | 'notFound' | 'unavailable';

export class ChannelServiceError extends Error {
  constructor(
    readonly kind: ChannelErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/**
 * ارتباط سرور به سرور با API گروه/کانال‌های tarabari_backend. کلید داخلی فقط
 * اینجا (سمت سرور) استفاده می‌شود و هیچ‌وقت به کاربر نمی‌رسد؛ userId را همیشه
 * لایه‌ی بالاتر از هویت تأییدشده‌ی کاربر (تلگرام/واتساپ) می‌دهد.
 */
@Injectable()
export class TarabariChannelsClient {
  private readonly logger = new Logger(TarabariChannelsClient.name);
  private readonly http: AxiosInstance;

  constructor(config: ConfigService) {
    this.http = axios.create({
      baseURL: config.get<string>('TARABARI_API_URL', 'http://localhost:3001/'),
      timeout: 15000,
      headers: { 'x-internal-api-key': config.get<string>('INTERNAL_API_KEY', '') },
    });
  }

  list(userId: string): Promise<MonitoredChannel[]> {
    return this.call(() => this.http.get('api/channels', { params: { userId } }));
  }

  // فقط منبع (source): بار از این گروه/کانال خوانده و به همین کاربر پیشنهاد می‌شود.
  register(
    userId: string,
    link: string,
    label?: string,
  ): Promise<{ created: boolean; channel: MonitoredChannel; warning?: string }> {
    return this.call(() => this.http.post('api/channels', { link, userId, label, role: 'source' }));
  }

  /** فقط این کاربر از ثبت‌کننده‌ها حذف می‌شود؛ ثبت‌کننده‌های دیگر دست نمی‌خورند. */
  async removeOwner(userId: string, platform: ChannelPlatform, id: string): Promise<void> {
    await this.call(() => this.http.delete(`api/channels/${platform}/${encodeURIComponent(id)}`, { params: { userId } }));
  }

  private async call<T>(request: () => Promise<{ data: T }>): Promise<T> {
    try {
      return (await request()).data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const { status, data } = error.response;
        const raw = (data as { message?: unknown } | undefined)?.message;
        const message = Array.isArray(raw) ? raw.join(' ') : typeof raw === 'string' ? raw : '';
        if (status === 400) throw new ChannelServiceError('invalid', message);
        if (status === 404) throw new ChannelServiceError('notFound', message);
        this.logger.error(`tarabari channels API responded ${status}: ${JSON.stringify(data)}`);
      } else {
        this.logger.error(`tarabari channels API unreachable: ${(error as Error).message}`);
      }
      throw new ChannelServiceError('unavailable', 'Channel service is unavailable.');
    }
  }
}
