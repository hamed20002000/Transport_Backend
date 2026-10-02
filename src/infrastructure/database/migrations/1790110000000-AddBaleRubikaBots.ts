import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ربات‌های بله و روبیکا کنار ربات تلگرام:
 *   - SubscriptionOrder.provider: مقدارهای BALE و RUBIKA
 *   - TelegramLink: ستون platform؛ هر کاربر در هر پیام‌رسان یک اتصال (به‌جای یک اتصال کلاً)
 *   - CargoNotification: وضعیت ارسال بله و روبیکا (مثل تلگرام)
 */
export class AddBaleRubikaBots1790110000000 implements MigrationInterface {
  name = 'AddBaleRubikaBots1790110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."SubscriptionOrder_provider_enum" ADD VALUE IF NOT EXISTS 'BALE'`);
    await queryRunner.query(`ALTER TYPE "public"."SubscriptionOrder_provider_enum" ADD VALUE IF NOT EXISTS 'RUBIKA'`);

    // TelegramLink ---------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN IF NOT EXISTS "platform" character varying(20) NOT NULL DEFAULT 'telegram'
    `);
    await queryRunner.query(`ALTER TABLE "TelegramLink" DROP CONSTRAINT IF EXISTS "UQ_2e5c581313dc53ffca088f67b56"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_TelegramLink_UserId"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_TelegramLink_UserId_Platform"
      ON "TelegramLink" ("userId", "platform")
    `);

    // CargoNotification ----------------------------------------------------
    for (const platform of ['bale', 'rubika']) {
      const enumName = `"public"."CargoNotification_${platform}status_enum"`;
      await queryRunner.query(`
        DO $$ BEGIN
          CREATE TYPE ${enumName} AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      // اعلان‌های قبلی هیچ‌وقت به این پیام‌رسان‌ها فرستاده نمی‌شوند -- SKIPPED، بعد پیش‌فرض PENDING.
      await queryRunner.query(`
        ALTER TABLE "CargoNotification"
        ADD COLUMN "${platform}Status" ${enumName} NOT NULL DEFAULT 'SKIPPED',
        ADD COLUMN "${platform}ChatId" character varying(100),
        ADD COLUMN "${platform}MessageId" character varying(100),
        ADD COLUMN "${platform}Attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN "${platform}NextRetryAt" TIMESTAMP
      `);
      await queryRunner.query(`ALTER TABLE "CargoNotification" ALTER COLUMN "${platform}Status" SET DEFAULT 'PENDING'`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const platform of ['rubika', 'bale']) {
      await queryRunner.query(`
        ALTER TABLE "CargoNotification"
        DROP COLUMN "${platform}NextRetryAt",
        DROP COLUMN "${platform}Attempts",
        DROP COLUMN "${platform}MessageId",
        DROP COLUMN "${platform}ChatId",
        DROP COLUMN "${platform}Status"
      `);
      await queryRunner.query(`DROP TYPE IF EXISTS "public"."CargoNotification_${platform}status_enum"`);
    }

    // اتصال‌های بله/روبیکا با محدودیت قبلی (یک اتصال برای هر کاربر) جور نیستند.
    await queryRunner.query(`DELETE FROM "TelegramLink" WHERE "platform" <> 'telegram'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_TelegramLink_UserId_Platform"`);
    await queryRunner.query(`ALTER TABLE "TelegramLink" ADD CONSTRAINT "UQ_2e5c581313dc53ffca088f67b56" UNIQUE ("userId")`);
    await queryRunner.query(`ALTER TABLE "TelegramLink" DROP COLUMN "platform"`);
    // PostgreSQL مقدار enum را حذف نمی‌کند؛ BALE/RUBIKA در SubscriptionOrder_provider_enum می‌مانند.
  }
}
