import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * دعوت شرکت شخصی می‌شود: شرکت مادر شماره‌ی شرکت را می‌دهد و حسابش همان لحظه ساخته می‌شود (تأییدشده از طرف شرکت
 * مادر)؛ لینک فقط برای همان شماره کار می‌کند. لینک‌های عمومی قبلی (بی‌شماره) دیگر معنی ندارند و پاک می‌شوند.
 */
export class PersonalCompanyInvites1790450000000 implements MigrationInterface {
  name = 'PersonalCompanyInvites1790450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "CompanyInvite"`);
    await queryRunner.query(`
      ALTER TABLE "CompanyInvite"
        ADD COLUMN IF NOT EXISTS "companyUserId" uuid NOT NULL,
        ADD COLUMN IF NOT EXISTS "mobile" character varying(20) NOT NULL,
        ADD COLUMN IF NOT EXISTS "usedAt" TIMESTAMP
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "CompanyInvite" ADD CONSTRAINT "FK_CompanyInvite_company" FOREIGN KEY ("companyUserId") REFERENCES "User"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_CompanyInvite_company" ON "CompanyInvite" ("companyUserId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_CompanyInvite_company"`);
    await queryRunner.query(`ALTER TABLE "CompanyInvite" DROP CONSTRAINT IF EXISTS "FK_CompanyInvite_company"`);
    await queryRunner.query(`ALTER TABLE "CompanyInvite" DROP COLUMN IF EXISTS "usedAt", DROP COLUMN IF EXISTS "mobile", DROP COLUMN IF EXISTS "companyUserId"`);
  }
}
