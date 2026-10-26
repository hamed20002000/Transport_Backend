import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SubscriptionBonus } from 'src/domain/entities/subscription/SubscriptionBonus';
import { SubscriptionOrderStatus, SubscriptionStatus } from 'src/domain/enums/subscription';
import { SubscriptionPolicyService } from './subscriptionPolicy.service';

const DAY_MS = 86_400_000;
// tomans and rials are added up as tomans; a payment in another currency does not count towards a tier
const TOMANS = `CASE o.currency WHEN 'IRT' THEN o.amount::numeric WHEN 'IRR' THEN o.amount::numeric / 10 END`;

export interface GrantedBonus {
  minTomans: number;
  days: number;
  startAt: Date;
  expireAt: Date;
}

/**
 * Rewards for drivers who bought a lot: once a driver's approved purchases add up to a tier of
 * SubscriptionPolicy.driverRewards («۲۰ میلیون تومان → ۳۰ روز»), they get that many free days, once per tier.
 * The free days follow whatever the driver already has (subscription or an earlier reward), so nothing paid is lost.
 */
@Injectable()
export class SubscriptionRewardService {
  private readonly logger = new Logger(SubscriptionRewardService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  /** What a user has paid in approved orders, in tomans (the subscription each payment created names the buyer). */
  async paidTomans(userId: string): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT coalesce(sum(${TOMANS}), 0) AS tomans
         FROM "SubscriptionOrder" o JOIN "Subscription" s ON s."orderId" = o.id
        WHERE o.status = $1 AND s."userId" = $2`,
      [SubscriptionOrderStatus.Approved, userId],
    );
    return Number(row.tomans);
  }

  /** Gives a driver every tier they have reached and not had yet; returns what was given now. */
  async grantEarned(userId: string, now = new Date()): Promise<GrantedBonus[]> {
    const tiers = await this.policy.getDriverRewards();
    if (!tiers.length || !(await this.isDriver(userId))) return [];
    const paid = await this.paidTomans(userId);
    const granted: GrantedBonus[] = [];
    for (const tier of tiers.filter((item) => paid >= item.minTomans)) {
      const bonus = await this.dataSource.transaction(async (manager) => {
        // one at a time per user, so two approvals at once cannot both give the same tier
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`subscription-bonus:${userId}`]);
        const reason = `paid:${tier.minTomans}`;
        if (await manager.findOne(SubscriptionBonus, { where: { userId, reason } })) return null;
        const startAt = await this.freeFrom(manager, userId, now);
        return manager.save(manager.create(SubscriptionBonus, {
          userId,
          reason,
          days: tier.freeDays,
          startAt,
          expireAt: new Date(startAt.getTime() + tier.freeDays * DAY_MS),
        }));
      });
      if (bonus) {
        granted.push({ minTomans: tier.minTomans, days: bonus.days, startAt: bonus.startAt, expireAt: bonus.expireAt });
        this.logger.log(`Driver ${userId} earned ${bonus.days} free days for passing ${tier.minTomans} tomans`);
      }
    }
    return granted;
  }

  /** After the tiers change: every driver who already paid enough gets what they are now due. */
  async grantEarnedForAll(): Promise<number> {
    const rows: { userId: string }[] = await this.dataSource.query(
      `SELECT DISTINCT s."userId" FROM "Subscription" s JOIN "SubscriptionOrder" o ON o.id = s."orderId" WHERE o.status = $1`,
      [SubscriptionOrderStatus.Approved],
    );
    let count = 0;
    for (const row of rows) count += (await this.grantEarned(row.userId)).length;
    return count;
  }

  /** The bonus the user is in now, if any (for the purchase page). */
  async activeUntil(userId: string, now = new Date()): Promise<Date | null> {
    const [row] = await this.dataSource.query(
      `SELECT max("expireAt") AS until FROM "SubscriptionBonus" WHERE "userId" = $1 AND "startAt" <= $2 AND "expireAt" > $2`,
      [userId, now],
    );
    return row?.until ? new Date(row.until) : null;
  }

  /** The later of now, the end of the active subscription, and the end of the last bonus. */
  private async freeFrom(manager: DataSource['manager'], userId: string, now: Date): Promise<Date> {
    const [row] = await manager.query(
      `SELECT greatest(
         $2::timestamp,
         (SELECT max("expireAt") FROM "Subscription" WHERE "userId" = $1 AND status = $3),
         (SELECT max("expireAt") FROM "SubscriptionBonus" WHERE "userId" = $1)
       ) AS "from"`,
      [userId, now, SubscriptionStatus.Active],
    );
    return new Date(row.from);
  }

  private async isDriver(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE ur."userId" = $1 AND r.name = 'DRIVER' LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }
}
