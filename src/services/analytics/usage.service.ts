import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { UsageEventKind } from 'src/domain/entities/analytics/UsageEvent';
import { UsageChannel } from 'src/domain/entities/analytics/usageChannel';
import { IBotLinkRepository } from 'src/domain/repositories/messengerBot/IBotLinkRepository';
import { BOT_LINK_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { parseBotId } from '../messengerBot/core/botPlatform';
import { RedisService } from '../redis/redis.service';

// a day's mark lives a little past the day
const DAY_MARK_SECONDS = 26 * 60 * 60;

/** «2026-11-03», in Iran's time (the days the admin reads the figures by) */
export function usageDay(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * Records what the admin's usage figures are read from (AdminStatsController.usage): who was active on which day and
 * through which channel, a few events (a link opened, a phone notification tapped, a load's details or request), and
 * how many load notices each channel delivered. Never in the way: a failure is only logged.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    @Inject(BOT_LINK_REPOSITORY) private readonly botLinks: IBotLinkRepository,
  ) {}

  /** The user was active today through this channel (once a day is written; the rest are skipped by Redis). */
  async active(userId: string, channel: UsageChannel, at = new Date()): Promise<void> {
    try {
      const day = usageDay(at);
      if (!(await this.redis.setIfAbsent(RedisService.key('usageActiveDay', channel, userId, day), '1', DAY_MARK_SECONDS))) return;
      await this.dataSource.query(
        `INSERT INTO "UserActivityDay" ("userId", "day", "channel") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, day, channel],
      );
    } catch (error) {
      this.logger.warn(`Activity of ${userId} on ${channel} not recorded: ${(error as Error).message}`);
    }
  }

  /** A message or button from a bot user («bale:123»): the user behind it, if linked, was active on that messenger. */
  async activeOnBot(externalUserId: string, at = new Date()): Promise<void> {
    try {
      const day = usageDay(at);
      if (!(await this.redis.setIfAbsent(RedisService.key('usageBotDay', externalUserId, day), '1', DAY_MARK_SECONDS))) return;
      const link = await this.botLinks.findByExternalUserId(externalUserId);
      if (link) await this.active(link.userId, parseBotId(externalUserId).platform, at);
    } catch (error) {
      this.logger.warn(`Bot activity of ${externalUserId} not recorded: ${(error as Error).message}`);
    }
  }

  /** The user has opened the installed app (PWA) at least once, on any device. */
  async openedInstalledApp(userId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(`SELECT 1 FROM "UserActivityDay" WHERE "userId" = $1 AND channel = 'pwa' LIMIT 1`, [userId]);
    return rows.length > 0;
  }

  async event(userId: string, kind: UsageEventKind, channel: UsageChannel, listingId?: string | null): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO "UsageEvent" ("userId", "kind", "channel", "listingId") VALUES ($1, $2, $3, $4)`,
        [userId, kind, channel, listingId ?? null],
      );
    } catch (error) {
      this.logger.warn(`Usage event ${kind} of ${userId} not recorded: ${(error as Error).message}`);
    }
  }

  /** Load notices delivered through a channel (a summary counts each load in it). */
  async delivered(channel: UsageChannel, count = 1, at = new Date()): Promise<void> {
    if (count <= 0) return;
    try {
      await this.dataSource.query(
        `INSERT INTO "NotificationDailyStat" ("day", "channel", "delivered") VALUES ($1, $2, $3)
         ON CONFLICT ("day", "channel") DO UPDATE SET "delivered" = "NotificationDailyStat"."delivered" + EXCLUDED."delivered"`,
        [usageDay(at), channel, count],
      );
    } catch (error) {
      this.logger.warn(`Delivered notices on ${channel} not counted: ${(error as Error).message}`);
    }
  }
}
