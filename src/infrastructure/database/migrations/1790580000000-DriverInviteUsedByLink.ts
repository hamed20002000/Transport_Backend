import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * دعوت راننده: آیا راننده با خود دعوت (لینک، یا کدش در پیام‌رسان) آمد یا خودش برنامه را پیدا کرد. فهرست رانندگان
 * شرکت «با لینک دعوت شما» را فقط برای اولی نشان می‌دهد. دعوت‌های استفاده‌شده‌ی قبلی، که تا امروز فقط از راه لینک
 * «وارد شده» می‌شدند، با لینک حساب می‌شوند.
 */
export class DriverInviteUsedByLink1790580000000 implements MigrationInterface {
  name = 'DriverInviteUsedByLink1790580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverInvite" ADD COLUMN IF NOT EXISTS "usedByLink" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`UPDATE "DriverInvite" SET "usedByLink" = true WHERE "usedAt" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverInvite" DROP COLUMN IF EXISTS "usedByLink"`);
  }
}
