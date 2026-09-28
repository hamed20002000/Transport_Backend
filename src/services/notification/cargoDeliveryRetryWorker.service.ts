import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CargoNotificationRepository } from '../../infrastructure/repositories/notification/cargoNotification.repository';
import { DELIVERY_RETRY_WINDOW_MS } from './cargoDeliveryRetry';
import { CargoNotificationService } from './cargoNotification.service';

/**
 * ارسال‌های تلگرام/واتساپ که با خطای موقت شکست خورده‌اند را در زمان تعیین‌شده
 * دوباره امتحان می‌کند. جدول CargoNotification خودش صف است، پس با ریستارت
 * برنامه چیزی گم نمی‌شود.
 */
@Injectable()
export class CargoDeliveryRetryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CargoDeliveryRetryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly notifications: CargoNotificationRepository,
    private readonly cargoNotifications: CargoNotificationService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('CARGO_DELIVERY_RETRY_WORKER', 'true') === 'false') return;
    const intervalMs = this.positive('CARGO_DELIVERY_RETRY_INTERVAL_MS', 30_000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One sweep; overlapping sweeps are skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - DELIVERY_RETRY_WINDOW_MS);

      const expired = await this.notifications.failExpiredPending(windowStart);
      if (expired) this.logger.warn(`Gave up on ${expired} cargo notification delivery(ies) after the retry window.`);

      const due = await this.notifications.findDueRetries(now, windowStart, 50);
      for (const row of due) {
        await this.cargoNotifications.retryDelivery(row, now);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Cargo delivery retry sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private positive(key: string, fallback: number): number {
    const value = Number(this.config.get(key, fallback));
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }
}
