import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The admin's usage figures: each user's active days per channel (app, browser, each messenger), usage events (a
 * link opened, a phone notification tapped, a load's details opened or the load asked for), load notices delivered
 * per day and channel, and where each load request came from.
 */
export class UsageAnalytics1790650000000 implements MigrationInterface {
  name = 'UsageAnalytics1790650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "UserActivityDay" (
        "userId" uuid NOT NULL,
        "day" date NOT NULL,
        "channel" varchar(20) NOT NULL,
        "firstAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_UserActivityDay" PRIMARY KEY ("userId", "day", "channel"),
        CONSTRAINT "FK_UserActivityDay_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_UserActivityDay_day" ON "UserActivityDay" ("day", "channel")`);
    await queryRunner.query(`
      CREATE TABLE "UsageEvent" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "kind" varchar(20) NOT NULL,
        "channel" varchar(20) NOT NULL,
        "listingId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_UsageEvent_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_UsageEvent_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_UsageEvent_kind_created" ON "UsageEvent" ("kind", "createdAt")`);
    await queryRunner.query(`
      CREATE TABLE "NotificationDailyStat" (
        "day" date NOT NULL,
        "channel" varchar(20) NOT NULL,
        "delivered" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_NotificationDailyStat" PRIMARY KEY ("day", "channel")
      )`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD "source" varchar(20)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN "source"`);
    await queryRunner.query(`DROP TABLE "NotificationDailyStat"`);
    await queryRunner.query(`DROP TABLE "UsageEvent"`);
    await queryRunner.query(`DROP TABLE "UserActivityDay"`);
  }
}
