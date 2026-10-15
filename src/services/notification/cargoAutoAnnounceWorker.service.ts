import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CargoListingService } from './cargoListing.service';
import { CompanyAnnounceService } from './companyAnnounce.service';

/**
 * اعلام خودکار شرکت‌ها: هر چند دقیقه نوبت شرکت‌هایی که بازه‌شان رسیده اجرا می‌شود
 * (پیشنهادهای تازه‌ی کانال‌ها و بارهای در صف، هر کدام به راننده‌های همان نوع).
 * زمان نوبت روی ردیف CompanyAnnounceSetting است، پس با ریستارت چیزی گم نمی‌شود.
 */
@Injectable()
export class CargoAutoAnnounceWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CargoAutoAnnounceWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly settings: CompanyAnnounceService,
    private readonly listings: CargoListingService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('CARGO_AUTO_ANNOUNCE_WORKER', 'true') === 'false') return;
    const intervalMs = Number(this.config.get('CARGO_AUTO_ANNOUNCE_CHECK_MS', 60_000)) || 60_000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One sweep; overlapping sweeps are skipped. A failing company does not stop the others. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const setting of await this.settings.due(now)) {
        try {
          // نوبت اول ثبت می‌شود تا خطای تکراری هر دقیقه دوباره اجرا نشود
          await this.settings.markRun(setting.userId, now);
          const done = await this.listings.autoAnnounce(setting.userId, setting.autoSince ?? setting.lastRunAt ?? now);
          if (done.suggestions || done.pending) {
            this.logger.log(`Auto-announced for ${setting.userId}: ${done.suggestions} suggestion(s), ${done.pending} queued listing(s)`);
          }
        } catch (error: unknown) {
          this.logger.error(`Auto announce for ${setting.userId} failed: ${(error as Error).message}`);
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Auto announce sweep failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
