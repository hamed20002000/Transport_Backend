import { MigrationInterface, QueryRunner } from 'typeorm';

/** خرید دسترسی واسط به بار شرکت‌ها: سفارش با فیش و دوره‌ی دسترسی با فهرست شرکت‌ها. */
export class AddBrokerAccess1790520000000 implements MigrationInterface {
  name = 'AddBrokerAccess1790520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "BrokerAccessOrder" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "kind" character varying(10) NOT NULL,
        "periodId" uuid,
        "companyUserIds" uuid[] NOT NULL,
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
        CONSTRAINT "PK_BrokerAccessOrder_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_BrokerAccessOrder_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_BrokerAccessOrder_user" ON "BrokerAccessOrder" ("userId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_BrokerAccessOrder_status" ON "BrokerAccessOrder" ("status", "createdAt")`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "BrokerAccessPeriod" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "companyUserIds" uuid[] NOT NULL,
        "startAt" TIMESTAMP NOT NULL,
        "expireAt" TIMESTAMP NOT NULL,
        "orderId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_BrokerAccessPeriod_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_BrokerAccessPeriod_order" UNIQUE ("orderId"),
        CONSTRAINT "FK_BrokerAccessPeriod_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_BrokerAccessPeriod_user" ON "BrokerAccessPeriod" ("userId", "expireAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "BrokerAccessPeriod"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "BrokerAccessOrder"`);
  }
}
