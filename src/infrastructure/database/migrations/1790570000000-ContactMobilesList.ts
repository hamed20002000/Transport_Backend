import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «موبایل اعلام بار» چندشماره‌ای شد (contactMobiles، با کاما). AddContactMobile روی دیتابیسی که نسخه‌ی اولش را اجرا کرده
 * بود ستون تک‌شماره‌ای contactMobile ساخته است: همان تغییر نام می‌گیرد و جا برای چند شماره پیدا می‌کند؛ هر دیتابیسی
 * که ستون تازه را از قبل دارد دست نمی‌خورد.
 */
export class ContactMobilesList1790570000000 implements MigrationInterface {
  name = 'ContactMobilesList1790570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'contactMobile') THEN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'contactMobiles') THEN
            UPDATE "User" SET "contactMobiles" = "contactMobile" WHERE "contactMobiles" IS NULL AND "contactMobile" IS NOT NULL;
            ALTER TABLE "User" DROP COLUMN "contactMobile";
          ELSE
            ALTER TABLE "User" RENAME COLUMN "contactMobile" TO "contactMobiles";
          END IF;
        END IF;
      END $$`);
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contactMobiles" varchar(100)`);
    await queryRunner.query(`ALTER TABLE "User" ALTER COLUMN "contactMobiles" TYPE varchar(100)`);
  }

  public async down(): Promise<void> {
    // the single-number column is not coming back: one mobile is a list of one
  }
}
