import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { BrokerDriver } from 'src/domain/helper/brokerDriver';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { CompanyFeatureService } from './companyFeature.service';

const toLatinDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** One driver the brokers named, by its mobile: the latest details given, who gave it, and its requests. */
export interface BrokerDriverRow {
  mobile: string;
  /** the latest details a broker gave (name, national code, plates, company, fare, referrer, …) */
  driver: BrokerDriver;
  /** the brokers that named it, the latest first */
  brokers: Array<{ userId: string; name: string; mobile: string | null; accountCode: string | null }>;
  requests: number;
  accepted: number;
  firstAt: Date;
  lastAt: Date;
  /** the latest request: its load and how it went */
  last: { origin: string; destination: string; code: string | null; status: string; exitBorder: string | null; company: string | null };
  /** a Trabot driver account with this mobile: its id, and whether it is one of the parent company's drivers */
  account: { userId: string; companyDriver: boolean } | null;
}

/**
 * The drivers brokers request loads for (CargoRequest.forDriver: no account is made for them), gathered by mobile for
 * the parent company: every broker's, with every detail given, for any company's loads. From here the parent company
 * can register one as its own driver (DriverInviteService.register); one of its drivers is no longer listed here.
 */
@Injectable()
export class BrokerDriversService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly features: CompanyFeatureService,
  ) {}

  async list(parentUserId: string, page: number, pageSize: number, search?: string): Promise<{ items: BrokerDriverRow[]; total: number; page: number; pageSize: number }> {
    if (!(await this.features.isParent(parentUserId))) throw new ForbiddenException('فقط شرکت مادر رانندگان واسط‌ها را می‌بیند.');
    const term = search?.trim() ? `%${toLatinDigits(search.trim()).replace(/\s+/g, '')}%` : null;
    // the requests that named a driver, with their broker and load; search in the driver's name, mobile, national
    // code, plates, and the broker's name
    const named = `
      SELECT r.id, r."createdAt", r.status, r."exitBorder", r."forDriver", r."forDriver"->>'mobile' AS mobile,
             b.id AS "brokerId", COALESCE(NULLIF(b."companyName", ''), NULLIF(concat_ws(' ', b."firstName", b."lastName"), ''), b.mobile) AS "brokerName",
             b.mobile AS "brokerMobile", b."accountCode" AS "brokerCode",
             l.origin, l.destination, l.code,
             COALESCE(NULLIF(c."companyName", ''), NULLIF(concat_ws(' ', c."firstName", c."lastName"), '')) AS company
        FROM "CargoRequest" r
        JOIN "User" b ON b.id = r."driverUserId"
        JOIN "CargoListing" l ON l.id = r."listingId"
        LEFT JOIN "User" c ON c.id = l."publisherUserId"
       WHERE r."forDriver" IS NOT NULL
         -- a driver that became one of the parent company's drivers leaves this list for good, even when a broker
         -- names it again later: it is in «رانندگان» now
         AND NOT EXISTS (
               SELECT 1 FROM "User" du
                 JOIN "UserRole" dur ON dur."userId" = du.id
                 JOIN "Role" dr ON dr.id = dur."roleId" AND dr.name = 'DRIVER'
                 LEFT JOIN "DriverProfile" dp ON dp."userId" = du.id
                WHERE du.mobile = r."forDriver"->>'mobile'
                  AND ($2::uuid = ANY(COALESCE(dp."companyUserIds", '{}'))
                       OR EXISTS (SELECT 1 FROM "DriverInvite" di WHERE di."driverUserId" = du.id AND di."companyUserId" = $2::uuid AND di."revokedAt" IS NULL)))
         AND ($1::text IS NULL
              OR replace(concat_ws('', r."forDriver"->>'name', r."forDriver"->>'mobile', r."forDriver"->>'nationalCode',
                         r."forDriver"->>'plate', r."forDriver"->>'transitPlate', b."companyName", b."firstName", b."lastName"), ' ', '') ILIKE $1)`;
    const [{ total }] = await this.dataSource.query(`SELECT COUNT(DISTINCT mobile)::int AS total FROM (${named}) n`, [term, parentUserId]);
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `WITH n AS (${named})
       SELECT n.mobile,
              (array_agg(n."forDriver" ORDER BY n."createdAt" DESC))[1] AS driver,
              COUNT(*)::int AS requests,
              COUNT(*) FILTER (WHERE n.status IN ('ACCEPTED', 'DELIVERED'))::int AS accepted,
              MIN(n."createdAt") AS "firstAt", MAX(n."createdAt") AS "lastAt",
              (array_agg(json_build_object('origin', n.origin, 'destination', n.destination, 'code', n.code, 'status', n.status,
                                           'exitBorder', COALESCE(n."exitBorder", n."forDriver"->>'exitBorder'), 'company', n.company)
                         ORDER BY n."createdAt" DESC))[1] AS last,
              json_agg(DISTINCT jsonb_build_object('userId', n."brokerId", 'name', n."brokerName", 'mobile', n."brokerMobile", 'accountCode', n."brokerCode")) AS brokers
         FROM n
        GROUP BY n.mobile
        ORDER BY MAX(n."createdAt") DESC
        LIMIT $3 OFFSET $4`,
      [term, parentUserId, pageSize, (page - 1) * pageSize],
    );
    const accounts = await this.accounts(rows.map((row) => String(row.mobile)), parentUserId);
    const items = rows.map((row) => ({
      mobile: row.mobile,
      driver: row.driver,
      brokers: row.brokers,
      requests: row.requests,
      accepted: row.accepted,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
      last: row.last,
      account: accounts.get(String(row.mobile)) ?? null,
    }));
    return { items, total: Number(total), page, pageSize };
  }

  /** The Trabot driver accounts of these mobiles, and whether each is one of the parent company's drivers. */
  private async accounts(mobiles: string[], parentUserId: string): Promise<Map<string, { userId: string; companyDriver: boolean }>> {
    if (!mobiles.length) return new Map();
    const rows: Array<{ mobile: string; userId: string; companyDriver: boolean }> = await this.dataSource.query(
      `SELECT u.mobile, u.id AS "userId",
              (COALESCE($2::uuid = ANY(p."companyUserIds"), false)
               OR EXISTS (SELECT 1 FROM "DriverInvite" i WHERE i."driverUserId" = u.id AND i."companyUserId" = $2::uuid AND i."revokedAt" IS NULL)) AS "companyDriver"
         FROM "User" u
         JOIN "UserRole" ur ON ur."userId" = u.id
         JOIN "Role" r ON r.id = ur."roleId" AND r.name = 'DRIVER' AND r."recordStatus" = $3
         LEFT JOIN "DriverProfile" p ON p."userId" = u.id
        WHERE u.mobile = ANY($1::text[]) AND u."recordStatus" = $3`,
      [mobiles, parentUserId, RecordStatus.Active],
    );
    return new Map(rows.map((row) => [row.mobile, { userId: row.userId, companyDriver: row.companyDriver }]));
  }
}
