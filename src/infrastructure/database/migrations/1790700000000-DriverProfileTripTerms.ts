import { MigrationInterface, QueryRunner } from 'typeorm';

/** پروفایل راننده: نام شرکت، مبلغ کرایه و مرز خروج (برای درخواست بار لازم‌اند). */
export class DriverProfileTripTerms1790700000000 implements MigrationInterface {
  name = 'DriverProfileTripTerms1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "companyName" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "fare" character varying(50)`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "exitBorder" character varying(60)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN IF EXISTS "exitBorder"`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN IF EXISTS "fare"`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN IF EXISTS "companyName"`);
  }
}
