import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * نوع راننده و بار (داخلی/صادراتی/وارداتی)، زمان اعلام بار و تنظیم اعلام خودکار شرکت.
 * بارهای موجود اعلام‌شده حساب می‌شوند تا دوباره فرستاده نشوند.
 */
export class AddCargoTripTypes1790230000000 implements MigrationInterface {
  name = 'AddCargoTripTypes1790230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD "tripType" character varying(10) NOT NULL DEFAULT 'DOMESTIC'`);
    await queryRunner.query(`ALTER TABLE "CargoListing" ADD "tripType" character varying(10) NOT NULL DEFAULT 'DOMESTIC'`);
    await queryRunner.query(`ALTER TABLE "CargoListing" ADD "announcedAt" TIMESTAMP`);
    await queryRunner.query(`UPDATE "CargoListing" SET "announcedAt" = "createdAt"`);
    await queryRunner.query(`CREATE INDEX "IDX_CargoListing_pending_announce" ON "CargoListing" ("publisherUserId") WHERE "announcedAt" IS NULL`);
    await queryRunner.query(
      `CREATE TABLE "CompanyAnnounceSetting" (
        "userId" uuid NOT NULL,
        "mode" character varying(10) NOT NULL DEFAULT 'MANUAL',
        "intervalMinutes" integer NOT NULL DEFAULT 120,
        "autoSince" TIMESTAMP,
        "lastRunAt" TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CompanyAnnounceSetting" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_CompanyAnnounceSetting_userId" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "CompanyAnnounceSetting"`);
    await queryRunner.query(`DROP INDEX "IDX_CargoListing_pending_announce"`);
    await queryRunner.query(`ALTER TABLE "CargoListing" DROP COLUMN "announcedAt"`);
    await queryRunner.query(`ALTER TABLE "CargoListing" DROP COLUMN "tripType"`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN "tripType"`);
  }
}
