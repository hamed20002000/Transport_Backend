import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CargoNotificationRepository } from '../../infrastructure/repositories/notification/cargoNotification.repository';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// a load taken by mistake can be reopened the same day: its messages are edited back while the notices are kept
const TAKEN_KEPT_MS = DAY_MS;
// a load still open after this long: its messages are no longer edited
const NOTICE_KEPT_MS = 30 * DAY_MS;

/**
 * A driver's notice of a load (CargoNotification) is only needed while the load is open: to edit the messages sent
 * («برداشته شد», a new phone number), to know who has it already, and for the unread count. Once the load is taken
 * (or the notice is old) it is deleted, so the table does not grow by every driver for every load.
 */
@Injectable()
export class CargoNotificationCleanupWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CargoNotificationCleanupWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly notifications: CargoNotificationRepository,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('CARGO_NOTIFICATION_CLEANUP', 'true') === 'false') return;
    this.timer = setInterval(() => void this.tick(), HOUR_MS);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deleted = await this.notifications.deleteFinished(new Date(now.getTime() - TAKEN_KEPT_MS), new Date(now.getTime() - NOTICE_KEPT_MS));
      if (deleted) this.logger.log(`Deleted ${deleted} finished cargo notice(s).`);
    } catch (error) {
      this.logger.error(`Cargo notice cleanup failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
