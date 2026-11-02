import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * طرح‌های برنزی، نقره‌ای و طلایی شرکت حمل‌ونقل: هر طرح چند بخش پنل را با هم باز می‌کند، برای ۱، ۳، ۶ یا ۱۲ ماه
 * (options: هر مدت قیمت خودش). سه ردیف ثابت ساخته می‌شوند و تا ادمین بخش‌ها و قیمت‌هایشان را تعیین و فعالشان نکند
 * غیرفعال‌اند. سفارش طرح در همان
 * CompanyFeatureOrder ثبت می‌شود (tier و features؛ planId و feature خالی) و تأییدش برای هر بخش یک
 * CompanyFeatureGrant می‌سازد، پس یکتا بودن orderId در Grant برداشته می‌شود.
 */
export class CompanyTierPlans1790600000000 implements MigrationInterface {
  name = 'CompanyTierPlans1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "CompanyTierPlan" (
        "tier" varchar(10) NOT NULL,
        "features" varchar(40)[] NOT NULL DEFAULT '{}',
        "options" jsonb NOT NULL DEFAULT '[]',
        "currency" varchar(10) NOT NULL DEFAULT 'IRR',
        "recordStatus" smallint NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CompanyTierPlan_tier" PRIMARY KEY ("tier")
      )`);
    await queryRunner.query(`INSERT INTO "CompanyTierPlan" ("tier") VALUES ('BRONZE'), ('SILVER'), ('GOLD')`);

    await queryRunner.query(`ALTER TABLE "CompanyFeatureOrder" ADD "tier" varchar(10)`);
    await queryRunner.query(`ALTER TABLE "CompanyFeatureOrder" ADD "features" varchar(40)[]`);
    await queryRunner.query(`ALTER TABLE "CompanyFeatureOrder" ALTER COLUMN "planId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "CompanyFeatureOrder" ALTER COLUMN "feature" DROP NOT NULL`);

    await queryRunner.query(`ALTER TABLE "CompanyFeatureGrant" DROP CONSTRAINT "UQ_CompanyFeatureGrant_order"`);
    await queryRunner.query(`CREATE INDEX "IDX_CompanyFeatureGrant_order" ON "CompanyFeatureGrant" ("orderId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_CompanyFeatureGrant_order"`);
    // a tier's grants share their order: only the first keeps it
    await queryRunner.query(`
      UPDATE "CompanyFeatureGrant" g SET "orderId" = NULL
       WHERE g."orderId" IS NOT NULL AND EXISTS (SELECT 1 FROM "CompanyFeatureGrant" o WHERE o."orderId" = g."orderId" AND o.id < g.id)`);
    await queryRunner.query(`ALTER TABLE "CompanyFeatureGrant" ADD CONSTRAINT "UQ_CompanyFeatureGrant_order" UNIQUE ("orderId")`);
    await queryRunner.query(`DELETE FROM "CompanyFeatureOrder" WHERE "tier" IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE "CompanyFeatureOrder" ALTER COLUMN "feature" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "CompanyFeatureOrder" ALTER COLUMN "planId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "CompanyFeatureOrder" DROP COLUMN "features"`);
    await queryRunner.query(`ALTER TABLE "CompanyFeatureOrder" DROP COLUMN "tier"`);
    await queryRunner.query(`DROP TABLE "CompanyTierPlan"`);
  }
}
