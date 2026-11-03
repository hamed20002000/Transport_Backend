import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { SubscriptionOrderStatus, SubscriptionStatus } from 'src/domain/enums/subscription';
import { SubscriptionPolicyService } from 'src/services/subscription/subscriptionPolicy.service';
import { CargoListingStatus, CargoTripType } from 'src/domain/enums/notification';
import { parseCargoPrice } from 'src/services/notification/cargoPrice';
import { requireAdmin } from './subscription-policy.controller';

type AdminRequest = Parameters<typeof requireAdmin>[0];

// revenue windows on the admin dashboard: last month, 3, 6 and 12 months
const PERIOD_DAYS = [30, 90, 180, 365] as const;
const TOP_PAYERS = 3;
const DAY_MS = 86_400_000;
const TRIP_TYPES = [CargoTripType.Domestic, CargoTripType.Export, CargoTripType.Import] as const;

/** One trip type over one window: loads, how many were taken, and the freight of the taken ones. */
interface LoadTotals {
  loads: number;
  taken: number;
  /** freight of taken loads quoted in tomans or rials, in tomans */
  freightTomans: number;
  /** freight of taken loads quoted in another currency (dollars, euros, …), kept apart */
  freightOther: Record<string, number>;
  /** taken loads whose freight text holds no clear amount («نقدی», «توافقی», a bare number) */
  takenUnpriced: number;
}
const emptyTotals = (): LoadTotals => ({ loads: 0, taken: 0, freightTomans: 0, freightOther: {}, takenUnpriced: 0 });

// prices are in rials or tomans; revenue is added up in rials. Other currencies are listed apart.
const RIALS = `CASE o.currency WHEN 'IRR' THEN o.amount::numeric WHEN 'IRT' THEN o.amount::numeric * 10 END`;

/**
 * Numbers for the admin dashboard: how many drivers and companies there are and where they stand with
 * subscriptions, what approved payments brought in over the last 1/3/6/12 months and in total, and the drivers
 * who paid the most. Approved orders are the payments; the buyer is the subscription each one created.
 */
@Controller('api/admin/stats')
@UseGuards(JwtAuthGuard)
export class AdminStatsController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly policy: SubscriptionPolicyService,
  ) {}

  @Get()
  async stats(@Req() request: AdminRequest) {
    requireAdmin(request);
    const [users, revenue, otherCurrencies, pending, topDrivers, loads] = await Promise.all([
      this.users(),
      this.revenue(),
      this.otherCurrencies(),
      this.pendingReceipts(),
      this.topDrivers(),
      this.loads(),
    ]);
    return { users, revenue, otherCurrencies, pendingReceipts: pending, topDrivers, loads, generatedAt: new Date().toISOString() };
  }

  /**
   * How drivers use the app and the messengers, over the last `days` days (7 to 365):
   * - pwa: drivers who ever opened the installed app (PWA), of all drivers;
   * - push: drivers with phone notifications on (on one device at least);
   * - weeklyActive: drivers active in the last 7 days, through any channel and through each;
   * - messengerToApp: of the drivers active in a messenger, how many also opened the app or the site; and the
   *   links in messenger messages (or phone notifications) that opened it, by where they were;
   * - requestSource: the load requests made, by where (app, browser, each messenger, the assistant);
   * - engagement: per channel, the load notices delivered and how many led to the load's details or a request
   *   there (for push: notifications tapped).
   * Recorded since the usage tables came (UsageService): earlier days have nothing.
   */
  @Get('usage')
  async usage(@Req() request: AdminRequest, @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    requireAdmin(request);
    const window = Math.min(Math.max(days, 7), 365);
    const since = new Date(Date.now() - window * DAY_MS);
    const n = (value: unknown) => Number(value ?? 0);
    const MESSENGERS = ['bale', 'eitaa', 'rubika', 'telegram', 'whatsapp'];
    const drivers = `SELECT u.id FROM "User" u JOIN "UserRole" ur ON ur."userId" = u.id
                      JOIN "Role" r ON r.id = ur."roleId" AND r."recordStatus" = $1 AND r.name = 'DRIVER' WHERE u."recordStatus" = $1`;
    const today = `(now() AT TIME ZONE 'Asia/Tehran')::date`;

    const [[base], weekly, crossChannel, linkOpens, requests, delivered, interactions, pushClicks] = await Promise.all([
      this.dataSource.query(
        `WITH d AS (${drivers})
         SELECT (SELECT count(*) FROM d) AS drivers,
                (SELECT count(DISTINCT a."userId") FROM "UserActivityDay" a JOIN d ON d.id = a."userId" WHERE a.channel = 'pwa') AS pwa,
                (SELECT count(DISTINCT p."userId") FROM "WebPushSubscription" p JOIN d ON d.id = p."userId") AS push,
                (SELECT count(DISTINCT a."userId") FROM "UserActivityDay" a JOIN d ON d.id = a."userId" WHERE a.day > ${today} - 7) AS "weeklyActive"`,
        [RecordStatus.Active],
      ),
      this.dataSource.query(
        `WITH d AS (${drivers})
         SELECT a.channel, count(DISTINCT a."userId") AS users FROM "UserActivityDay" a JOIN d ON d.id = a."userId"
          WHERE a.day > ${today} - 7 GROUP BY a.channel`,
        [RecordStatus.Active],
      ),
      this.dataSource.query(
        `WITH d AS (${drivers}),
              m AS (SELECT DISTINCT a."userId" FROM "UserActivityDay" a JOIN d ON d.id = a."userId"
                     WHERE a.day > ${today} - $2::int AND a.channel = ANY($3::text[]))
         SELECT (SELECT count(*) FROM m) AS messenger,
                (SELECT count(*) FROM m WHERE EXISTS (SELECT 1 FROM "UserActivityDay" w WHERE w."userId" = m."userId"
                   AND w.day > ${today} - $2::int AND w.channel IN ('pwa', 'web'))) AS "alsoApp"`,
        [RecordStatus.Active, window, MESSENGERS],
      ),
      this.dataSource.query(
        `SELECT channel, count(*) AS opens, count(DISTINCT "userId") AS users FROM "UsageEvent"
          WHERE kind = 'link_open' AND "createdAt" >= $1 GROUP BY channel`,
        [since],
      ),
      this.dataSource.query(
        `SELECT COALESCE(source, 'unknown') AS source, count(*) AS requests FROM "CargoRequest" WHERE "createdAt" >= $1 GROUP BY 1`,
        [since],
      ),
      this.dataSource.query(
        `SELECT channel, sum(delivered) AS delivered FROM "NotificationDailyStat" WHERE day > ${today} - $1::int GROUP BY channel`,
        [window],
      ),
      // a driver and a load count once per channel, whether it opened the details, asked for it, or both
      this.dataSource.query(
        `SELECT channel, count(*) AS interacted FROM (
           SELECT channel, "userId", "listingId" FROM "UsageEvent" WHERE kind = 'load_detail' AND "createdAt" >= $1 AND "listingId" IS NOT NULL
           UNION
           SELECT source, "driverUserId", "listingId" FROM "CargoRequest" WHERE "createdAt" >= $1 AND source IS NOT NULL
         ) t GROUP BY channel`,
        [since],
      ),
      this.dataSource.query(`SELECT count(*) AS clicks FROM "UsageEvent" WHERE kind = 'push_click' AND "createdAt" >= $1`, [since]),
    ]);

    const total = n(base.drivers);
    const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
    const byChannel = <T extends Record<string, unknown>>(rows: T[], key: keyof T, value: keyof T) =>
      Object.fromEntries(rows.map((row) => [String(row[key]), n(row[value])]));
    const sent = byChannel(delivered as Array<{ channel: string; delivered: string }>, 'channel', 'delivered');
    const acted = byChannel(interactions as Array<{ channel: string; interacted: string }>, 'channel', 'interacted');
    acted.push = n(pushClicks[0]?.clicks);
    const [cross] = crossChannel;
    return {
      days: window,
      drivers: total,
      pwa: { installed: n(base.pwa), rate: rate(n(base.pwa), total) },
      push: { subscribed: n(base.push), rate: rate(n(base.push), total) },
      weeklyActive: { drivers: n(base.weeklyActive), rate: rate(n(base.weeklyActive), total), byChannel: byChannel(weekly, 'channel', 'users') },
      messengerToApp: {
        messengerDrivers: n(cross.messenger),
        alsoApp: n(cross.alsoApp),
        rate: rate(n(cross.alsoApp), n(cross.messenger)),
        linkOpens: (linkOpens as Array<{ channel: string; opens: string; users: string }>).map((row) => ({ channel: row.channel, opens: n(row.opens), users: n(row.users) })),
      },
      requestSource: byChannel(requests, 'source', 'requests'),
      engagement: [...new Set([...Object.keys(sent), ...Object.keys(acted)])]
        .filter((channel) => sent[channel] || acted[channel])
        .map((channel) => ({ channel, delivered: sent[channel] ?? 0, interacted: acted[channel] ?? 0, rate: rate(acted[channel] ?? 0, sent[channel] ?? 0) })),
    };
  }

  /** Drivers and companies, and how many of them are subscribed, in their free month, or must buy. */
  private async users() {
    const rule = await this.policy.getDriverRule();
    const [row] = await this.dataSource.query(
      `WITH people AS (
         SELECT u.id, u."createdAt",
                bool_or(r.name = 'DRIVER') AS driver,
                bool_or(r.name IN ('COMPANY', 'COMPANY_ADMIN')) AS company,
                EXISTS (SELECT 1 FROM "Subscription" s
                         WHERE s."userId" = u.id AND s.status = $2 AND s."startAt" <= now() AND s."expireAt" > now()) AS subscribed
           FROM "User" u
           JOIN "UserRole" ur ON ur."userId" = u.id
           JOIN "Role" r ON r.id = ur."roleId" AND r."recordStatus" = $1
          WHERE u."recordStatus" = $1
          GROUP BY u.id)
       SELECT
         count(*) FILTER (WHERE driver)                                   AS "drivers",
         count(*) FILTER (WHERE driver AND subscribed)                    AS "driversSubscribed",
         count(*) FILTER (WHERE driver AND NOT subscribed
           AND GREATEST("createdAt", $3::timestamp) + make_interval(days => $4) > now()) AS "driversInTrial",
         count(*) FILTER (WHERE driver AND "createdAt" > now() - interval '30 days') AS "driversNewThisMonth",
         count(*) FILTER (WHERE company)                                  AS "companies",
         count(*) FILTER (WHERE company AND subscribed)                   AS "companiesSubscribed",
         count(*) FILTER (WHERE company AND "createdAt" > now() - interval '30 days') AS "companiesNewThisMonth"
       FROM people`,
      [RecordStatus.Active, SubscriptionStatus.Active, rule.driverTrialStartedAt, rule.driverTrialDays],
    );
    const n = (value: unknown) => Number(value ?? 0);
    const drivers = n(row.drivers);
    const subscribed = n(row.driversSubscribed);
    const trial = rule.driversEnforced ? n(row.driversInTrial) : 0;
    return {
      drivers: {
        total: drivers,
        subscribed,
        inTrial: trial,
        // free period over and no subscription: can only buy (0 while the driver rule is off)
        mustSubscribe: rule.driversEnforced ? Math.max(0, drivers - subscribed - trial) : 0,
        newThisMonth: n(row.driversNewThisMonth),
      },
      companies: { total: n(row.companies), subscribed: n(row.companiesSubscribed), newThisMonth: n(row.companiesNewThisMonth) },
    };
  }

  /** Approved payments, in rials, for each window and in total. */
  private async revenue() {
    const windows = PERIOD_DAYS.map((days) =>
      `coalesce(sum(${RIALS}) FILTER (WHERE o."approvedAt" > now() - interval '${days} days'), 0) AS "rials${days}",
       count(*) FILTER (WHERE o."approvedAt" > now() - interval '${days} days' AND ${RIALS} IS NOT NULL) AS "count${days}"`).join(',\n');
    const [row] = await this.dataSource.query(
      `SELECT ${windows},
              coalesce(sum(${RIALS}), 0) AS "rialsAll",
              count(*) FILTER (WHERE ${RIALS} IS NOT NULL) AS "countAll"
         FROM "SubscriptionOrder" o
        WHERE o.status = $1`,
      [SubscriptionOrderStatus.Approved],
    );
    return {
      periods: PERIOD_DAYS.map((days) => ({ days, rials: String(row[`rials${days}`]), payments: Number(row[`count${days}`]) })),
      total: { rials: String(row.rialsAll), payments: Number(row.countAll) },
    };
  }

  /**
   * Loads by trip type (domestic / export / import, «unknown» when the route could not be placed) for each
   * window and in total. «Income» is the freight of the loads a driver took: the price is free text, read by
   * parseCargoPrice; tomans are added up, other currencies kept apart, unreadable prices counted.
   */
  private async loads() {
    const rows: { tripType: string | null; status: string; price: string | null; createdAt: Date }[] = await this.dataSource.query(
      `SELECT "tripType", status, price, "createdAt" FROM "CargoListing"`,
    );
    const now = Date.now();
    const windows = [...PERIOD_DAYS.map((days) => ({ days: days as number | null, since: now - days * DAY_MS })), { days: null, since: 0 }];
    const result = windows.map(({ days }) => ({
      days,
      byType: Object.fromEntries([...TRIP_TYPES, 'UNKNOWN'].map((type) => [type, emptyTotals()])) as Record<string, LoadTotals>,
    }));
    for (const row of rows) {
      const type = row.tripType && (TRIP_TYPES as readonly string[]).includes(row.tripType) ? row.tripType : 'UNKNOWN';
      const taken = row.status === CargoListingStatus.Taken;
      const price = taken ? parseCargoPrice(row.price) : null;
      const created = new Date(row.createdAt).getTime();
      windows.forEach((window, index) => {
        if (created < window.since) return;
        const totals = result[index].byType[type];
        totals.loads++;
        if (!taken) return;
        totals.taken++;
        if (!price) totals.takenUnpriced++;
        else if (price.currency === 'IRT') totals.freightTomans += price.amount;
        else totals.freightOther[price.currency] = (totals.freightOther[price.currency] ?? 0) + price.amount;
      });
    }
    return { periods: result.filter((item) => item.days !== null), total: result.find((item) => item.days === null)!.byType };
  }

  /** Payments in a currency that is not rial or toman (pound, euro, …): not added into the rial figures. */
  private async otherCurrencies(): Promise<{ currency: string; amount: string; payments: number }[]> {
    const rows: { currency: string; amount: string; payments: string }[] = await this.dataSource.query(
      `SELECT o.currency, sum(o.amount::numeric) AS amount, count(*) AS payments
         FROM "SubscriptionOrder" o
        WHERE o.status = $1 AND o.currency NOT IN ('IRR', 'IRT')
        GROUP BY o.currency ORDER BY o.currency`,
      [SubscriptionOrderStatus.Approved],
    );
    return rows.map((row) => ({ currency: row.currency, amount: String(row.amount), payments: Number(row.payments) }));
  }

  private async pendingReceipts(): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT count(*) AS n FROM "SubscriptionOrder" WHERE status IN ($1, $2)`,
      [SubscriptionOrderStatus.ReceiptSubmitted, SubscriptionOrderStatus.UnderReview],
    );
    return Number(row.n);
  }

  /** The drivers whose approved payments add up to the most (the subscription each payment created names the buyer). */
  private async topDrivers() {
    const rows: { userId: string; name: string | null; mobile: string | null; rials: string; payments: string; lastPaidAt: Date }[] =
      await this.dataSource.query(
        `SELECT u.id AS "userId",
                nullif(trim(concat_ws(' ', u."firstName", u."lastName")), '') AS name,
                coalesce(u.mobile, u.username) AS mobile,
                sum(${RIALS}) AS rials,
                count(*) AS payments,
                max(o."approvedAt") AS "lastPaidAt"
           FROM "SubscriptionOrder" o
           JOIN "Subscription" s ON s."orderId" = o.id
           JOIN "User" u ON u.id = s."userId"
          WHERE o.status = $1 AND ${RIALS} IS NOT NULL
            AND EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
                         WHERE ur."userId" = u.id AND r.name = 'DRIVER')
          GROUP BY u.id
          ORDER BY rials DESC
          LIMIT $2`,
        [SubscriptionOrderStatus.Approved, TOP_PAYERS],
      );
    return rows.map((row) => ({ ...row, rials: String(row.rials), payments: Number(row.payments) }));
  }
}
