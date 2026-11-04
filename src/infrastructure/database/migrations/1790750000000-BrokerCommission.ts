import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * طلب واسط از شرکت: کمیسیون هر سفر تحویل‌شده‌ی واسط (درصد ادمین از کرایه‌ای که واسط داده) همان لحظه‌ی تحویل روی
 * درخواست ثبت می‌شود، و پرداخت‌های شرکت به واسط (تسویه‌ها) جدا.
 */
export class BrokerCommission1790750000000 implements MigrationInterface {
  name = 'BrokerCommission1790750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD COLUMN IF NOT EXISTS "brokerCommission" bigint`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD COLUMN IF NOT EXISTS "brokerCommissionPercent" numeric(5,2)`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "BrokerSettlement" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "companyUserId" uuid NOT NULL,
        "brokerUserId" uuid NOT NULL,
        "amount" bigint NOT NULL,
        "note" character varying(300),
        "createdByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_BrokerSettlement" PRIMARY KEY ("id"),
        CONSTRAINT "FK_BrokerSettlement_company" FOREIGN KEY ("companyUserId") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_BrokerSettlement_broker" FOREIGN KEY ("brokerUserId") REFERENCES "User"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_BrokerSettlement_company_broker" ON "BrokerSettlement" ("companyUserId", "brokerUserId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "BrokerSettlement"`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN IF EXISTS "brokerCommissionPercent"`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN IF EXISTS "brokerCommission"`);
  }
}
