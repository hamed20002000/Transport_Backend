import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DriverInviteService } from './driverInvite.service';

/**
 * دعوت راننده‌ای که در مهلتش (پیش‌فرض یک روز) استفاده نشد منقضی می‌شود (DriverInviteService.expireStale). مهلت از
 * زمان ساخت خود دعوت حساب می‌شود، پس با ریستارت برنامه چیزی گم نمی‌شود.
 */
@Injectable()
export class DriverInviteExpiryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DriverInviteExpiryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly invites: DriverInviteService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = Number(this.config.get('DRIVER_INVITE_EXPIRY_INTERVAL_MS', 10 * 60_000)) || 10 * 60_000;
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
      const count = await this.invites.expireStale();
      if (count) this.logger.log(`Expired ${count} driver invite(s) nobody used in time.`);
    } catch (error: unknown) {
      this.logger.error(`Driver invite expiry failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
