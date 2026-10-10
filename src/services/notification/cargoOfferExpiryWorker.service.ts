import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CargoTripService } from './cargoTrip.service';

/**
 * بار سپرده‌شده‌ای که راننده تا پایان مهلت تأیید نکرد دوباره باز می‌شود (CargoTripService.expireOffers).
 * مهلت روی خود ردیف CargoRequest است، پس با ریستارت برنامه چیزی گم نمی‌شود.
 */
@Injectable()
export class CargoOfferExpiryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CargoOfferExpiryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly trips: CargoTripService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('CARGO_OFFER_EXPIRY_WORKER', 'true') === 'false') return;
    const intervalMs = Number(this.config.get('CARGO_OFFER_EXPIRY_INTERVAL_MS', 60_000)) || 60_000;
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
      const count = await this.trips.expireOffers();
      if (count) this.logger.log(`Expired ${count} cargo offer(s) a driver did not answer.`);
    } catch (error: unknown) {
      this.logger.error(`Cargo offer expiry failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
