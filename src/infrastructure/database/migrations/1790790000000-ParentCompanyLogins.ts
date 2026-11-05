import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * شماره‌هایی که با ورود (OTP) وارد حساب شرکت مادر می‌شوند و هم‌زمان می‌توانند وارد باشند؛ بقیه‌ی حساب‌ها در هر لحظه
 * فقط یک نشست وب دارند (SessionService).
 */
export class ParentCompanyLogins1790790000000 implements MigrationInterface {
  name = 'ParentCompanyLogins1790790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ParentCompanyLogin" (
        "mobile" character varying(11) NOT NULL,
        "note" character varying(100),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ParentCompanyLogin" PRIMARY KEY ("mobile"),
        CONSTRAINT "CHK_ParentCompanyLogin_mobile" CHECK ("mobile" ~ '^09[0-9]{9}$')
      )`);
    await queryRunner.query(`
      INSERT INTO "ParentCompanyLogin" ("mobile") VALUES ('09394113259'), ('09148982858'), ('09144919503')
      ON CONFLICT ("mobile") DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ParentCompanyLogin"`);
  }
}
