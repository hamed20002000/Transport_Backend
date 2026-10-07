import { MigrationInterface, QueryRunner } from 'typeorm';

/** زمان دریافت آخرین موقعیت راننده و سابقه‌ی موقعیت‌ها برای شرکت. */
export class AddDriverLocationLog1790170000000 implements MigrationInterface {
  name = 'AddDriverLocationLog1790170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverLocation" ADD COLUMN "receivedAt" TIMESTAMP NOT NULL DEFAULT now()`);
    await queryRunner.query(`UPDATE "DriverLocation" SET "receivedAt" = "updatedAt"`);

    await queryRunner.query(`
      CREATE TABLE "DriverLocationLog" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "live" boolean NOT NULL DEFAULT false,
        "receivedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_DriverLocationLog_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_DriverLocationLog_userId" FOREIGN KEY ("userId")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_DriverLocationLog_user_received" ON "DriverLocationLog" ("userId", "receivedAt")`);
    // موقعیت‌های فعلی اولین ردیف سابقه‌اند
    await queryRunner.query(`
      INSERT INTO "DriverLocationLog" ("userId", "latitude", "longitude", "live", "receivedAt")
      SELECT "userId", "latitude", "longitude", "liveUntil" IS NOT NULL, "receivedAt" FROM "DriverLocation"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "DriverLocationLog"`);
    await queryRunner.query(`ALTER TABLE "DriverLocation" DROP COLUMN "receivedAt"`);
  }
}
