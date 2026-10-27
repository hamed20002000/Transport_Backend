import { MigrationInterface, QueryRunner } from 'typeorm';

/** کارخانه (صاحب بار): نقش FACTORY، لینک دعوت شرکت حمل‌ونقل، شرکت‌های هر کارخانه و بارهایی که فرستاده. */
export class AddFactories1790430000000 implements MigrationInterface {
  name = 'AddFactories1790430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "Role" ("name", "title", "recordStatus")
      SELECT 'FACTORY', 'کارخانه', 0
      WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'FACTORY')
    `);
    // AccountType is stored as a Postgres enum on the subscription tables
    await queryRunner.query(`ALTER TYPE "public"."SubscriptionPlan_accounttype_enum" ADD VALUE IF NOT EXISTS 'FACTORY'`);
    await queryRunner.query(`ALTER TYPE "public"."SubscriptionOrder_accounttype_enum" ADD VALUE IF NOT EXISTS 'FACTORY'`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "FactoryInvite" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "token" character varying(64) NOT NULL,
        "companyUserId" uuid NOT NULL,
        "revokedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_FactoryInvite_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_FactoryInvite_token" UNIQUE ("token"),
        CONSTRAINT "FK_FactoryInvite_company" FOREIGN KEY ("companyUserId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_FactoryInvite_company" ON "FactoryInvite" ("companyUserId", "revokedAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "FactoryCompany" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "factoryUserId" uuid NOT NULL,
        "companyUserId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_FactoryCompany_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_FactoryCompany_factory_company" UNIQUE ("factoryUserId", "companyUserId"),
        CONSTRAINT "FK_FactoryCompany_factory" FOREIGN KEY ("factoryUserId") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_FactoryCompany_company" FOREIGN KEY ("companyUserId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_FactoryCompany_company" ON "FactoryCompany" ("companyUserId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "FactoryCargo" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "factoryUserId" uuid NOT NULL,
        "companyUserId" uuid NOT NULL,
        "origin" character varying(200) NOT NULL,
        "destination" character varying(200) NOT NULL,
        "cargoType" character varying(200),
        "weight" character varying(100),
        "vehicleType" character varying(200),
        "price" character varying(100),
        "extraNotes" text,
        "contactPhones" character varying[] NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_FactoryCargo_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_FactoryCargo_factory" FOREIGN KEY ("factoryUserId") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_FactoryCargo_company" FOREIGN KEY ("companyUserId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_FactoryCargo_factory" ON "FactoryCargo" ("factoryUserId", "createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "FactoryCargo"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "FactoryCompany"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "FactoryInvite"`);
    // the FACTORY value stays in the enums: Postgres cannot drop an enum value
    await queryRunner.query(`DELETE FROM "Role" r WHERE r."name" = 'FACTORY' AND NOT EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."roleId" = r.id)`);
  }
}
