import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CargoTripService, deliveryReminderDays } from './cargoTrip.service';

/**
 * «تحویل داده شد؟»: سفر فعالی که TRIP_DELIVERY_REMINDER_DAYS روز (پیش‌فرض ۳) از شروعش گذشته و
 * تحویلش ثبت نشده به شرکت یادآوری می‌شود (CargoTripService.remindDeliveries)؛ هر همان‌قدر روز تکرار.
 * زمان یادآوری روی خود ردیف CargoRequest است، پس با ریستارت دوباره فرستاده نمی‌شود.
 */
@Injectable()
export class CargoDeliveryReminderWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CargoDeliveryReminderWorker.name);
  private timer?: NodeJS.Timeout;
  private firstRun?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly trips: CargoTripService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('TRIP_DELIVERY_REMINDER_WORKER', 'true') === 'false') return;
    const intervalMs = Number(this.config.get('TRIP_DELIVERY_REMINDER_INTERVAL_MS', 60 * 60_000)) || 60 * 60_000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // یک بار هم کمی بعد از بالا آمدن (پیام‌رسان‌ها وصل شده باشند)، تا ریستارت یادآوری را یک ساعت عقب نیندازد
    this.firstRun = setTimeout(() => void this.tick(), 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
  }

  /** One sweep; overlapping sweeps are skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.trips.remindDeliveries(deliveryReminderDays());
      if (count) this.logger.log(`Reminded ${count} company trip(s) to register delivery.`);
    } catch (error: unknown) {
      this.logger.error(`Trip delivery reminder failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
