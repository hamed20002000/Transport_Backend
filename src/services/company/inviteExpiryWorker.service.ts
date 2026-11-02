import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { RedisService } from '../redis/redis.service';
import { expireStaleInvites } from './inviteRules';

/**
 * دعوتی (راننده، کارخانه، شرکت) که در مهلتش (پیش‌فرض یک روز) استفاده نشد منقضی می‌شود (inviteRules.expireStaleInvites).
 * مهلت از زمان ساخت خود دعوت حساب می‌شود، پس با ریستارت برنامه چیزی گم نمی‌شود.
 */
@Injectable()
export class InviteExpiryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InviteExpiryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = Number(this.config.get('INVITE_EXPIRY_INTERVAL_MS', 10 * 60_000)) || 10 * 60_000;
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
      const count = await expireStaleInvites(this.dataSource, this.redis);
      if (count) this.logger.log(`Expired ${count} invite(s) nobody used in time.`);
    } catch (error: unknown) {
      this.logger.error(`Invite expiry failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
