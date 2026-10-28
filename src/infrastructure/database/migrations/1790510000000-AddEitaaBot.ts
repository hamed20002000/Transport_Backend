import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ربات ایتا کنار تلگرام، بله و روبیکا (حساب کاربری ایتا از راه GoOmni؛ ایتا ربات رسمی دوطرفه ندارد):
 *   - SubscriptionOrder.provider: مقدار EITAA
 *   - CargoNotification: وضعیت ارسال ایتا (مثل بله و روبیکا)
 * اتصال کاربر همان TelegramLink با platform = 'eitaa' است و ستون تازه‌ای نمی‌خواهد.
 */
export class AddEitaaBot1790510000000 implements MigrationInterface {
  name = 'AddEitaaBot1790510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."SubscriptionOrder_provider_enum" ADD VALUE IF NOT EXISTS 'EITAA'`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."CargoNotification_eitaastatus_enum" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    // اعلان‌های قبلی هیچ‌وقت به ایتا فرستاده نمی‌شوند -- SKIPPED، بعد پیش‌فرض PENDING.
    await queryRunner.query(`
      ALTER TABLE "CargoNotification"
      ADD COLUMN "eitaaStatus" "public"."CargoNotification_eitaastatus_enum" NOT NULL DEFAULT 'SKIPPED',
      ADD COLUMN "eitaaChatId" character varying(100),
      ADD COLUMN "eitaaMessageId" character varying(100),
      ADD COLUMN "eitaaAttempts" integer NOT NULL DEFAULT 0,
      ADD COLUMN "eitaaNextRetryAt" TIMESTAMP
    `);
    await queryRunner.query(`ALTER TABLE "CargoNotification" ALTER COLUMN "eitaaStatus" SET DEFAULT 'PENDING'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "CargoNotification"
      DROP COLUMN "eitaaNextRetryAt",
      DROP COLUMN "eitaaAttempts",
      DROP COLUMN "eitaaMessageId",
      DROP COLUMN "eitaaChatId",
      DROP COLUMN "eitaaStatus"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."CargoNotification_eitaastatus_enum"`);
    await queryRunner.query(`DELETE FROM "TelegramLink" WHERE "platform" = 'eitaa'`);
    // PostgreSQL مقدار enum را حذف نمی‌کند؛ EITAA در SubscriptionOrder_provider_enum می‌ماند.
  }
}
