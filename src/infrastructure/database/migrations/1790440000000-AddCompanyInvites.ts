import { MigrationInterface, QueryRunner } from 'typeorm';

/** لینک دعوت شرکت مادر برای شرکت‌های حمل‌ونقل غیرمادر؛ شرکت دعوت‌شده تا خرید هیچ بخشی ندارد. */
export class AddCompanyInvites1790440000000 implements MigrationInterface {
  name = 'AddCompanyInvites1790440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "invitedByCompanyUserId" uuid`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "User" ADD CONSTRAINT "FK_User_invitedByCompany" FOREIGN KEY ("invitedByCompanyUserId") REFERENCES "User"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_User_invitedByCompany" ON "User" ("invitedByCompanyUserId")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "CompanyInvite" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "token" character varying(64) NOT NULL,
        "parentUserId" uuid NOT NULL,
        "revokedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CompanyInvite_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_CompanyInvite_token" UNIQUE ("token"),
        CONSTRAINT "FK_CompanyInvite_parent" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_CompanyInvite_parent" ON "CompanyInvite" ("parentUserId", "revokedAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "CompanyInvite"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_User_invitedByCompany"`);
    await queryRunner.query(`ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "FK_User_invitedByCompany"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "invitedByCompanyUserId"`);
  }
}
