import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { COMPANY_FEATURE_TITLES, COMPANY_TIER_TITLES, CompanyFeature, CompanyTier } from 'src/domain/enums/companyFeature';
import { SubscriptionNotifier } from '../notification/subscriptionNotifier.service';
import { RedisService } from '../redis/redis.service';
import { PlanExpiringNotice } from './planExpiring';

const DAY_MS = 86_400_000;

interface EndingRow {
  userId: string;
  feature: CompanyFeature;
  endsAt: Date;
  tier: CompanyTier | null;
}

/**
 * A week (COMPANY_PLAN_REMIND_DAYS) before a company's bought menus close — a tier's, or a menu's own — the company hears
 * of it once, in the app (phone notification), its bots and WhatsApp, with what closes and when, so it can renew or buy
 * another tier in time. A menu's end is the end of its whole chain of periods: renewed already, nothing is said. Parent
 * companies have every menu and are never told.
 */
@Injectable()
export class CompanyPlanExpiryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CompanyPlanExpiryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly notifier: SubscriptionNotifier,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = Number(this.config.get('COMPANY_PLAN_REMIND_INTERVAL_MS', 60 * 60_000)) || 60 * 60_000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private remindDays(): number {
    return Number(this.config.get('COMPANY_PLAN_REMIND_DAYS', 7)) || 7;
  }

  /** One sweep; overlapping sweeps are skipped. */
  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      let sent = 0;
      for (const notice of await this.expiring(now)) {
        // once per company and end date, whichever server instance sees it first
        const key = RedisService.key('companyPlanReminded', notice.userId, notice.endsAt.toISOString().slice(0, 10));
        if (!(await this.redis.setIfAbsent(key, '1', (this.remindDays() + 3) * 86_400))) continue;
        await this.notifier.planExpiring(notice);
        sent += 1;
      }
      if (sent) this.logger.log(`Told ${sent} compan(ies) their bought menus close soon.`);
      return sent;
    } catch (error: unknown) {
      this.logger.error(`Plan expiry reminder failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Companies whose earliest bought menu closes within the reminder days: those menus, their tier and the day. */
  async expiring(now: Date): Promise<PlanExpiringNotice[]> {
    const rows: EndingRow[] = await this.dataSource.query(
      `WITH ends AS (
         SELECT g."userId", g.feature, max(g."expireAt") AS "endsAt"
           FROM "CompanyFeatureGrant" g
          WHERE g."expireAt" > $1 AND g."startAt" <= $1
             OR g."expireAt" > $1 AND EXISTS (
                  SELECT 1 FROM "CompanyFeatureGrant" s WHERE s."userId" = g."userId" AND s.feature = g.feature AND s."startAt" <= $1 AND s."expireAt" > $1)
          GROUP BY g."userId", g.feature
       )
       SELECT e."userId", e.feature, e."endsAt",
              (SELECT o.tier FROM "CompanyFeatureGrant" g JOIN "CompanyFeatureOrder" o ON o.id = g."orderId"
                WHERE g."userId" = e."userId" AND g.feature = e.feature AND g."expireAt" = e."endsAt" LIMIT 1) AS tier
         FROM ends e
         JOIN "User" u ON u.id = e."userId" AND NOT u."isParentCompany"
        WHERE e."endsAt" <= $2
        ORDER BY e."endsAt"`,
      [now, new Date(now.getTime() + this.remindDays() * DAY_MS)],
    );
    const byUser = new Map<string, EndingRow[]>();
    for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    return [...byUser.entries()].map(([userId, ending]) => {
      // the first to close sets the day; menus closing within a day of it go in the same notice
      const endsAt = new Date(ending[0].endsAt);
      const same = ending.filter((row) => new Date(row.endsAt).getTime() - endsAt.getTime() < DAY_MS);
      const tier = same.find((row) => row.tier)?.tier ?? null;
      return {
        userId,
        tierTitle: tier ? `طرح ${COMPANY_TIER_TITLES[tier]}` : null,
        features: same.map((row) => COMPANY_FEATURE_TITLES[row.feature] ?? row.feature),
        endsAt,
        daysLeft: Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)),
      };
    });
  }
}
