import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * کرایه و وزن هر سفر در دو مرحله، هر کدام یک ردیف جدا در TripFare: «توافق» (قبول درخواست یا سپردن بار) و «تحویل»
 * (تأیید تحویل). مرحله‌ی توافق بعد از شروع سفر عوض نمی‌شود تا هر دو برای آمار بمانند.
 * روی CargoRequest: نحوه‌ی دریافت واسط (کمیسیون یا اختلاف کرایه) و سهم اختلاف کرایه‌ی واسط.
 * view «TripFareReport»: هر سفر در یک سطر با بار، طرفین، هر دو مرحله و سهم واسط؛ پایه‌ی گزارش‌ها.
 */
export class TripFare1790780000000 implements MigrationInterface {
  name = 'TripFare1790780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "TripFare" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "requestId" uuid NOT NULL,
        "stage" character varying(12) NOT NULL,
        "basis" character varying(10) NOT NULL,
        "rate" bigint NOT NULL,
        "weightTons" numeric(8,2) NOT NULL,
        "total" bigint NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'IRT',
        "changeReason" character varying(20),
        "note" character varying(300),
        "enteredByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_TripFare" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_TripFare_stage" CHECK ("stage" IN ('AGREED', 'DELIVERED')),
        CONSTRAINT "CHK_TripFare_basis" CHECK ("basis" IN ('TOTAL', 'PER_TON')),
        CONSTRAINT "CHK_TripFare_amounts" CHECK ("rate" > 0 AND "total" > 0 AND "weightTons" > 0),
        CONSTRAINT "FK_TripFare_requestId" FOREIGN KEY ("requestId") REFERENCES "CargoRequest"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_TripFare_enteredByUserId" FOREIGN KEY ("enteredByUserId") REFERENCES "User"("id") ON DELETE SET NULL
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_TripFare_request_stage" ON "TripFare" ("requestId", "stage")`);

    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD COLUMN IF NOT EXISTS "brokerPayModel" character varying(12)`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD COLUMN IF NOT EXISTS "brokerMargin" bigint`);

    await queryRunner.query(`
      CREATE OR REPLACE VIEW "TripFareReport" AS
      SELECT
        r."id"                        AS "requestId",
        r."listingId",
        l."code"                      AS "listingCode",
        r."companyUserId",
        r."driverUserId"              AS "partyUserId",
        (r."forDriver" IS NOT NULL)   AS "isBroker",
        r."status",
        l."tripType",
        l."origin",
        l."destination",
        l."cargoType",
        l."price"                     AS "listedPrice",
        l."weight"                    AS "listedWeight",
        r."decidedAt"                 AS "startedAt",
        r."deliveredAt",
        a."basis"                     AS "agreedBasis",
        a."rate"                      AS "agreedRate",
        a."weightTons"                AS "agreedWeightTons",
        a."total"                     AS "agreedTotal",
        a."currency"                  AS "agreedCurrency",
        d."basis"                     AS "deliveredBasis",
        d."rate"                      AS "deliveredRate",
        d."weightTons"                AS "deliveredWeightTons",
        d."total"                     AS "deliveredTotal",
        d."currency"                  AS "deliveredCurrency",
        d."changeReason",
        CASE WHEN a."currency" = d."currency" THEN d."total" - a."total" END AS "totalChange",
        CASE WHEN r."forDriver" IS NOT NULL THEN COALESCE(r."brokerPayModel", 'COMMISSION') END AS "brokerPayModel",
        CASE WHEN r."forDriver"->>'fare' ~ '^[0-9]+$' THEN (r."forDriver"->>'fare')::bigint END AS "brokerDriverFare",
        r."brokerCommission",
        r."brokerCommissionPercent",
        r."brokerMargin"
      FROM "CargoRequest" r
      JOIN "CargoListing" l ON l."id" = r."listingId"
      LEFT JOIN "TripFare" a ON a."requestId" = r."id" AND a."stage" = 'AGREED'
      LEFT JOIN "TripFare" d ON d."requestId" = r."id" AND d."stage" = 'DELIVERED'
      WHERE r."status" IN ('ACCEPTED', 'DELIVERED') OR a."id" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS "TripFareReport"`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN IF EXISTS "brokerMargin"`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN IF EXISTS "brokerPayModel"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "TripFare"`);
  }
}
