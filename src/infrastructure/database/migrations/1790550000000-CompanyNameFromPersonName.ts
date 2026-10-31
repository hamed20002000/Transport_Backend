import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * شرکت حمل‌ونقل، کارخانه و واسط با «نام تجاری» (companyName) شناخته می‌شوند: سربرگ پنل، پروفایل و فهرست‌ها همین را
 * نشان می‌دهند. حسابی که نامش از راه‌های قبلی فقط در نام و نام خانوادگی مانده، همان را نام تجاری می‌گیرد تا سربرگ و
 * پروفایل یکی باشند.
 */
export class CompanyNameFromPersonName1790550000000 implements MigrationInterface {
  name = 'CompanyNameFromPersonName1790550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "User" u SET "companyName" = trim(concat_ws(' ', u."firstName", u."lastName"))
      WHERE coalesce(trim(u."companyName"), '') = ''
        AND trim(concat_ws(' ', u."firstName", u."lastName")) <> ''
        AND EXISTS (
          SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
          WHERE ur."userId" = u.id AND r.name IN ('COMPANY', 'COMPANY_ADMIN', 'FACTORY', 'BROKER')
        )`);
  }

  public async down(): Promise<void> {
    // which names were copied is not kept; the person name stays as it was, so nothing is lost
  }
}
