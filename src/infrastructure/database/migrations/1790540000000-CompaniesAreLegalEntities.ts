import { MigrationInterface, QueryRunner } from 'typeorm';

/** شرکت حمل‌ونقل و کارخانه همیشه حقوقی‌اند؛ پروفایل‌های «حقیقی» یا خالیِ قبلی حقوقی می‌شوند. */
export class CompaniesAreLegalEntities1790540000000 implements MigrationInterface {
  name = 'CompaniesAreLegalEntities1790540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "User" u SET "profileType" = 1
      WHERE u."profileType" IS DISTINCT FROM 1
        AND EXISTS (
          SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
          WHERE ur."userId" = u.id AND r.name IN ('COMPANY', 'COMPANY_ADMIN', 'FACTORY')
        )`);
  }

  public async down(): Promise<void> {
    // the previous «حقیقی» choice is not kept, so there is nothing to restore
  }
}
