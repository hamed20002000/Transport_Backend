import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * واسط: درخواست بار بسته‌ای خریده می‌شود (هر بسته N درخواست به قیمت ثابت؛ BrokerAccessOrder با kind = PACKAGE و
 * requests) و مانده‌اش در BrokerRequestCredit است. شرکت‌ها را واسط خودش انتخاب می‌کند (تا سقف ادمین، بی‌پول و
 * بی‌زمان)، پس BrokerAccessPeriod.expireAt و مدت سفارش دیگر لازم نیستند.
 */
export class BrokerRequestPackages1790610000000 implements MigrationInterface {
  name = 'BrokerRequestPackages1790610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "BrokerAccessPeriod" ALTER COLUMN "expireAt" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "BrokerAccessOrder" ALTER COLUMN "durationDays" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "BrokerAccessOrder" ADD "requests" integer`);
    await queryRunner.query(`
      CREATE TABLE "BrokerRequestCredit" (
        "userId" uuid NOT NULL,
        "remaining" integer NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_BrokerRequestCredit_user" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_BrokerRequestCredit_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "BrokerRequestCredit"`);
    await queryRunner.query(`DELETE FROM "BrokerAccessOrder" WHERE "kind" = 'PACKAGE'`);
    await queryRunner.query(`ALTER TABLE "BrokerAccessOrder" DROP COLUMN "requests"`);
    // what had no time gets a year from its start
    await queryRunner.query(`UPDATE "BrokerAccessOrder" SET "durationDays" = 365 WHERE "durationDays" IS NULL`);
    await queryRunner.query(`ALTER TABLE "BrokerAccessOrder" ALTER COLUMN "durationDays" SET NOT NULL`);
    await queryRunner.query(`UPDATE "BrokerAccessPeriod" SET "expireAt" = "startAt" + interval '365 days' WHERE "expireAt" IS NULL`);
    await queryRunner.query(`ALTER TABLE "BrokerAccessPeriod" ALTER COLUMN "expireAt" SET NOT NULL`);
  }
}
