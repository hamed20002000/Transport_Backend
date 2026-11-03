import { MigrationInterface, QueryRunner } from 'typeorm';

/** شماره پروانه‌ی فعالیت شرکت حمل‌ونقل: بررسی اعتبار شرکت به‌جای کد اقتصادی با آن است. */
export class CompanyLicenseNo1790670000000 implements MigrationInterface {
  name = 'CompanyLicenseNo1790670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "licenseNo" character varying(30)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "licenseNo"`);
  }
}
