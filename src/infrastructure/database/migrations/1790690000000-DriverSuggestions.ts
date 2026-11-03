import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «معرفی راننده» برای واسط (پولی): مختصات مبدأ و مقصد هر بار (برای پیدا کردن مسیرهای نزدیک)، اعتبار معرفی واسط،
 * و پیشنهادی که به هر راننده رفته (BrokerDriverOffer).
 */
export class DriverSuggestions1790690000000 implements MigrationInterface {
  name = 'DriverSuggestions1790690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "CargoListing"
        ADD COLUMN IF NOT EXISTS "originLat" double precision,
        ADD COLUMN IF NOT EXISTS "originLng" double precision,
        ADD COLUMN IF NOT EXISTS "destinationLat" double precision,
        ADD COLUMN IF NOT EXISTS "destinationLng" double precision,
        ADD COLUMN IF NOT EXISTS "pointsCheckedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "BrokerRequestCredit" ADD COLUMN IF NOT EXISTS "suggestions" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`
      CREATE TABLE "BrokerDriverOffer" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "brokerUserId" uuid NOT NULL,
        "listingId" uuid NOT NULL,
        "driverUserId" uuid NOT NULL,
        "reason" character varying(200) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'SENT',
        "expiresAt" TIMESTAMP NOT NULL,
        "respondedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_BrokerDriverOffer" PRIMARY KEY ("id"),
        CONSTRAINT "FK_BrokerDriverOffer_broker" FOREIGN KEY ("brokerUserId") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_BrokerDriverOffer_listing" FOREIGN KEY ("listingId") REFERENCES "CargoListing"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_BrokerDriverOffer_driver" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_BrokerDriverOffer_listing_broker_driver" ON "BrokerDriverOffer" ("listingId", "brokerUserId", "driverUserId")`);
    await queryRunner.query(`CREATE INDEX "IDX_BrokerDriverOffer_driver_status" ON "BrokerDriverOffer" ("driverUserId", "status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "BrokerDriverOffer"`);
    await queryRunner.query(`DELETE FROM "BrokerAccessOrder" WHERE "kind" = 'SUGGESTION'`);
    await queryRunner.query(`ALTER TABLE "BrokerRequestCredit" DROP COLUMN IF EXISTS "suggestions"`);
    await queryRunner.query(`
      ALTER TABLE "CargoListing"
        DROP COLUMN IF EXISTS "originLat", DROP COLUMN IF EXISTS "originLng",
        DROP COLUMN IF EXISTS "destinationLat", DROP COLUMN IF EXISTS "destinationLng",
        DROP COLUMN IF EXISTS "pointsCheckedAt"`);
  }
}
