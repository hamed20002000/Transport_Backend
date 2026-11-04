import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { BrokerSettlement } from 'src/domain/entities/company/BrokerSettlement';
import { BrokerAccessService } from './brokerAccess.service';

/** What a company and one broker stand at: amounts are decimal strings (bigint), in the unit the fares were given in. */
export interface BrokerAccount {
  broker: { userId: string; name: string; mobile: string | null; accountCode: string | null };
  /** distinct drivers of its delivered trips */
  drivers: number;
  /** its trips on this company's loads that were delivered */
  trips: number;
  /** the fares of those trips that were bare numbers */
  fares: string;
  /** delivered trips whose fare was not a bare number («1500 دلار»): no commission is counted for them */
  unpriced: number;
  /** the broker's commission on those trips */
  earned: string;
  /** what the company paid it (BrokerSettlement) */
  paid: string;
  /** earned less paid */
  remaining: string;
}

// a fare given as a bare number (readBrokerDriverField keeps only its digits)
const NUMERIC_FARE = `r."forDriver"->>'fare' ~ '^[0-9]+$'`;
// the commission fixed at delivery; a trip delivered before commissions were kept: today's percent of its fare
const COMMISSION = `COALESCE(r."brokerCommission", CASE WHEN ${NUMERIC_FARE} THEN round((r."forDriver"->>'fare')::numeric * $2 / 100) END)`;

const BROKER_NAME = (alias: string) =>
  `COALESCE(NULLIF(${alias}."companyName", ''), NULLIF(concat_ws(' ', ${alias}."firstName", ${alias}."lastName"), ''), ${alias}.mobile)`;

/**
 * A transport company's account with each broker: the drivers it brought and the trips of them that were delivered on
 * this company's loads, the broker's commission on them (the admin's percent of each fare, CargoRequest.brokerCommission),
 * what the company paid it (BrokerSettlement), and what is left. Only the company's own loads count.
 */
@Injectable()
export class BrokerLedgerService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: BrokerAccessService,
  ) {}

  async accounts(companyUserId: string): Promise<{ commissionPercent: number; accounts: BrokerAccount[] }> {
    const { commissionPercent } = await this.access.getPolicy();
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `WITH trips AS (
         SELECT r."driverUserId" AS "brokerId",
                COUNT(DISTINCT r."forDriver"->>'mobile')::int AS drivers,
                COUNT(*)::int AS trips,
                COALESCE(SUM((r."forDriver"->>'fare')::numeric) FILTER (WHERE ${NUMERIC_FARE}), 0) AS fares,
                COUNT(*) FILTER (WHERE NOT ${NUMERIC_FARE} OR r."forDriver"->>'fare' IS NULL)::int AS unpriced,
                COALESCE(SUM(${COMMISSION}), 0) AS earned
           FROM "CargoRequest" r
          WHERE r."companyUserId" = $1 AND r."forDriver" IS NOT NULL AND r.status = 'DELIVERED'
          GROUP BY r."driverUserId"),
       paid AS (
         SELECT "brokerUserId" AS "brokerId", SUM(amount) AS paid FROM "BrokerSettlement" WHERE "companyUserId" = $1 GROUP BY 1)
       SELECT b.id AS "userId", ${BROKER_NAME('b')} AS name, b.mobile, b."accountCode",
              COALESCE(t.drivers, 0) AS drivers, COALESCE(t.trips, 0) AS trips, COALESCE(t.fares, 0)::text AS fares,
              COALESCE(t.unpriced, 0) AS unpriced, COALESCE(t.earned, 0)::text AS earned, COALESCE(p.paid, 0)::text AS paid,
              (COALESCE(t.earned, 0) - COALESCE(p.paid, 0))::text AS remaining
         FROM trips t FULL JOIN paid p ON p."brokerId" = t."brokerId"
         JOIN "User" b ON b.id = COALESCE(t."brokerId", p."brokerId")
        ORDER BY (COALESCE(t.earned, 0) - COALESCE(p.paid, 0)) DESC, name`,
      [companyUserId, commissionPercent],
    );
    return {
      commissionPercent,
      accounts: rows.map((row) => ({
        broker: { userId: row.userId, name: row.name, mobile: row.mobile ?? null, accountCode: row.accountCode ?? null },
        drivers: Number(row.drivers),
        trips: Number(row.trips),
        fares: row.fares,
        unpriced: Number(row.unpriced),
        earned: row.earned,
        paid: row.paid,
        remaining: row.remaining,
      })),
    };
  }

  /** One broker's delivered trips on this company's loads, each with its fare and commission, and the payments made. */
  async detail(companyUserId: string, brokerUserId: string) {
    const { commissionPercent } = await this.access.getPolicy();
    const account = (await this.accounts(companyUserId)).accounts.find((item) => item.broker.userId === brokerUserId);
    if (!account) throw new NotFoundException('حسابی با این واسط ندارید.');
    const trips: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT r.id, r."deliveredAt", l.origin, l.destination, l.code, r."exitBorder",
              r."forDriver"->>'name' AS "driverName", r."forDriver"->>'mobile' AS "driverMobile", r."forDriver"->>'fare' AS fare,
              ${COMMISSION}::text AS commission, COALESCE(r."brokerCommissionPercent", $2)::text AS percent
         FROM "CargoRequest" r JOIN "CargoListing" l ON l.id = r."listingId"
        WHERE r."companyUserId" = $1 AND r."driverUserId" = $3 AND r."forDriver" IS NOT NULL AND r.status = 'DELIVERED'
        ORDER BY r."deliveredAt" DESC NULLS LAST`,
      [companyUserId, commissionPercent, brokerUserId],
    );
    const settlements = await this.dataSource.getRepository(BrokerSettlement).find({
      where: { companyUserId, brokerUserId },
      order: { createdAt: 'DESC' },
    });
    return { account, trips, settlements };
  }

  /** A payment to the broker, up to what is left; a mistaken one is deleted (removeSettlement). */
  async settle(companyUserId: string, brokerUserId: string, amount: string, note: string | null, byUserId: string) {
    if (!/^[1-9][0-9]{0,17}$/.test(amount)) throw new BadRequestException('مبلغ تسویه را با عدد درست وارد کنید.');
    const account = (await this.accounts(companyUserId)).accounts.find((item) => item.broker.userId === brokerUserId);
    if (!account) throw new NotFoundException('حسابی با این واسط ندارید.');
    if (BigInt(amount) > BigInt(account.remaining)) throw new BadRequestException('مبلغ تسویه از مانده‌ی طلب واسط بیشتر است.');
    const repository = this.dataSource.getRepository(BrokerSettlement);
    await repository.save(repository.create({ companyUserId, brokerUserId, amount, note: note?.trim() || null, createdByUserId: byUserId }));
    return this.detail(companyUserId, brokerUserId);
  }

  async removeSettlement(companyUserId: string, settlementId: string) {
    const repository = this.dataSource.getRepository(BrokerSettlement);
    const settlement = await repository.findOne({ where: { id: settlementId, companyUserId } });
    if (!settlement) throw new NotFoundException('این تسویه پیدا نشد.');
    await repository.delete({ id: settlementId });
    return this.detail(companyUserId, settlement.brokerUserId);
  }
}
