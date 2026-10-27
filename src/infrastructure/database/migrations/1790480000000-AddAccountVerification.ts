import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * بررسی اعتبار شرکت حمل‌ونقل و کارخانه‌ای که خودش ثبت‌نام می‌کند (شرکت مادر تأیید یا رد می‌کند). همه‌ی حساب‌های
 * فعلی تأییدشده‌اند (پیش‌فرض APPROVED)؛ فقط ثبت‌نام‌های تازه‌ی شرکت و کارخانه با NONE شروع می‌شوند.
 */
export class AddAccountVerification1790480000000 implements MigrationInterface {
  name = 'AddAccountVerification1790480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "User"
        ADD COLUMN IF NOT EXISTS "verificationStatus" character varying(20) NOT NULL DEFAULT 'APPROVED',
        ADD COLUMN IF NOT EXISTS "verificationRequests" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "verificationNote" character varying(500),
        ADD COLUMN IF NOT EXISTS "verificationRequestedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "verificationDecidedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "verificationDecidedBy" uuid
    `);
    // the parent companies' list of requests to review
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_User_verificationStatus" ON "User" ("verificationStatus") WHERE "verificationStatus" <> 'APPROVED'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_User_verificationStatus"`);
    await queryRunner.query(`
      ALTER TABLE "User"
        DROP COLUMN IF EXISTS "verificationDecidedBy", DROP COLUMN IF EXISTS "verificationDecidedAt",
        DROP COLUMN IF EXISTS "verificationRequestedAt", DROP COLUMN IF EXISTS "verificationNote",
        DROP COLUMN IF EXISTS "verificationRequests", DROP COLUMN IF EXISTS "verificationStatus"
    `);
  }
}
