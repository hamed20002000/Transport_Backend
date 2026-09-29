import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * کد پیگیری بار (TRB...) روی CargoListing. بار منتشرشده از پیشنهاد همان کد
 * tarabari_backend را نگه می‌دارد؛ بار دستی از manual_cargo_code_seq کد می‌گیرد
 * که از 90000000 شروع می‌شود تا با کدهای tarabari (از 100000) تداخل نداشته باشد.
 */
export class AddCargoCode1790100000000 implements MigrationInterface {
  name = 'AddCargoCode1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE "manual_cargo_code_seq" START WITH 90000000`);
    await queryRunner.query(`ALTER TABLE "CargoListing" ADD COLUMN "code" character varying(20)`);

    // بارهای منتشرشده از پیشنهاد: کد از payload اعلان (اگر رویداد کد داشته باشد).
    await queryRunner.query(`
      UPDATE "CargoListing" l
      SET "code" = n."payload"->>'code'
      FROM "CargoNotification" n
      WHERE n."id" = l."sourceNotificationId" AND n."payload"->>'code' IS NOT NULL
    `);
    // بقیه (بار دستی و رویدادهای قدیمی بدون کد) به ترتیب زمان ساخت.
    await queryRunner.query(`
      UPDATE "CargoListing" l
      SET "code" = 'TRB' || nextval('manual_cargo_code_seq')
      FROM (SELECT "id" FROM "CargoListing" WHERE "code" IS NULL ORDER BY "createdAt") o
      WHERE l."id" = o."id"
    `);

    await queryRunner.query(`ALTER TABLE "CargoListing" ALTER COLUMN "code" SET NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_CargoListing_code" ON "CargoListing" ("code")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_CargoListing_code"`);
    await queryRunner.query(`ALTER TABLE "CargoListing" DROP COLUMN "code"`);
    await queryRunner.query(`DROP SEQUENCE "manual_cargo_code_seq"`);
  }
}
