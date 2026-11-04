import { MigrationInterface, QueryRunner } from 'typeorm';

/** مبلغ کرایه از پروفایل راننده برداشته شد (نام شرکت برای راننده‌ی بین‌المللی و بیمه‌نامه برای داخلی می‌ماند). */
export class DriverProfileDropFare1790730000000 implements MigrationInterface {
  name = 'DriverProfileDropFare1790730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN IF EXISTS "fare"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "fare" character varying(50)`);
  }
}
