import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * مرز خروج (یا ورود) از پروفایل راننده به خود درخواست بار می‌رود: راننده و واسط هر بار از فهرست مرزهای سمت مقصد
 * انتخابش می‌کنند.
 */
export class RequestExitBorder1790720000000 implements MigrationInterface {
  name = 'RequestExitBorder1790720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD COLUMN IF NOT EXISTS "exitBorder" character varying(60)`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN IF EXISTS "exitBorder"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "exitBorder" character varying(60)`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN IF EXISTS "exitBorder"`);
  }
}
