import { MigrationInterface, QueryRunner } from 'typeorm';

/** شرکت مادر و خرید منوها (feature) برای شرکت‌های غیرمادر: پلن قیمت، سفارش با فیش، دوره‌ی باز بودن. */
export class AddCompanyFeatures1790420000000 implements MigrationInterface {
  name = 'AddCompanyFeatures1790420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isParentCompany" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "CompanyFeaturePlan" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "feature" character varying(40) NOT NULL,
        "title" character varying(150) NOT NULL,
        "durationDays" integer NOT NULL,
        "price" bigint NOT NULL,
        "currency" character varying(10) NOT NULL DEFAULT 'IRR',
        "recordStatus" smallint NOT NULL DEFAULT 0,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CompanyFeaturePlan_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_CompanyFeaturePlan_feature" ON "CompanyFeaturePlan" ("feature", "recordStatus")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "CompanyFeatureOrder" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "planId" uuid NOT NULL,
        "feature" character varying(40) NOT NULL,
        "durationDays" integer NOT NULL,
        "amount" bigint NOT NULL,
        "currency" character varying(10) NOT NULL DEFAULT 'IRR',
        "status" character varying(30) NOT NULL DEFAULT 'RECEIPT_SUBMITTED',
        "receiptPath" text NOT NULL,
        "rejectionReason" character varying(500),
        "reviewedBy" uuid,
        "reviewedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CompanyFeatureOrder_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_CompanyFeatureOrder_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_CompanyFeatureOrder_plan" FOREIGN KEY ("planId") REFERENCES "CompanyFeaturePlan"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_CompanyFeatureOrder_user" ON "CompanyFeatureOrder" ("userId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_CompanyFeatureOrder_status" ON "CompanyFeatureOrder" ("status", "createdAt")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "CompanyFeatureGrant" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "feature" character varying(40) NOT NULL,
        "startAt" TIMESTAMP NOT NULL,
        "expireAt" TIMESTAMP NOT NULL,
        "orderId" uuid,
        "grantedBy" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CompanyFeatureGrant_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_CompanyFeatureGrant_order" UNIQUE ("orderId"),
        CONSTRAINT "FK_CompanyFeatureGrant_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_CompanyFeatureGrant_order" FOREIGN KEY ("orderId") REFERENCES "CompanyFeatureOrder"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_CompanyFeatureGrant_user_feature" ON "CompanyFeatureGrant" ("userId", "feature", "expireAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "CompanyFeatureGrant"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "CompanyFeatureOrder"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "CompanyFeaturePlan"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "isParentCompany"`);
  }
}
