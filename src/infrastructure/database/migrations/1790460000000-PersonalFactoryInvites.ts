import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * دعوت کارخانه هم شخصی می‌شود (مثل دعوت شرکت): شرکت شماره‌ی کارخانه را می‌دهد و حسابش همان لحظه ساخته می‌شود؛ لینک
 * فقط برای همان شماره کار می‌کند. لینک‌های عمومی قبلی (بی‌شماره) پاک می‌شوند؛ کارخانه‌هایی که با آن‌ها عضو شده‌اند
 * (FactoryCompany) می‌مانند.
 */
export class PersonalFactoryInvites1790460000000 implements MigrationInterface {
  name = 'PersonalFactoryInvites1790460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "FactoryInvite"`);
    await queryRunner.query(`
      ALTER TABLE "FactoryInvite"
        ADD COLUMN IF NOT EXISTS "factoryUserId" uuid NOT NULL,
        ADD COLUMN IF NOT EXISTS "mobile" character varying(20) NOT NULL,
        ADD COLUMN IF NOT EXISTS "usedAt" TIMESTAMP
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "FactoryInvite" ADD CONSTRAINT "FK_FactoryInvite_factory" FOREIGN KEY ("factoryUserId") REFERENCES "User"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_FactoryInvite_company_factory" ON "FactoryInvite" ("companyUserId", "factoryUserId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_FactoryInvite_company_factory"`);
    await queryRunner.query(`ALTER TABLE "FactoryInvite" DROP CONSTRAINT IF EXISTS "FK_FactoryInvite_factory"`);
    await queryRunner.query(`ALTER TABLE "FactoryInvite" DROP COLUMN IF EXISTS "usedAt", DROP COLUMN IF EXISTS "mobile", DROP COLUMN IF EXISTS "factoryUserId"`);
  }
}
