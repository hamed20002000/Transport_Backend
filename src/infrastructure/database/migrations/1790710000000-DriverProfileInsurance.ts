import { MigrationInterface, QueryRunner } from 'typeorm';

/** پروفایل راننده: شماره و تاریخ اعتبار بیمه‌نامه (اختیاری). */
export class DriverProfileInsurance1790710000000 implements MigrationInterface {
  name = 'DriverProfileInsurance1790710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "insuranceNumber" character varying(30)`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "insuranceExpiry" character varying(10)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN IF EXISTS "insuranceExpiry"`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN IF EXISTS "insuranceNumber"`);
  }
}
