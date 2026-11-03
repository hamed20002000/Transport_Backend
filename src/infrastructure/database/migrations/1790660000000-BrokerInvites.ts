import { MigrationInterface, QueryRunner } from 'typeorm';

/** دعوت شخصی واسط از طرف شرکت حمل‌ونقل، مثل دعوت کارخانه (BrokerInvite). */
export class BrokerInvites1790660000000 implements MigrationInterface {
  name = 'BrokerInvites1790660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "BrokerInvite" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "token" character varying(64) NOT NULL,
        "companyUserId" uuid NOT NULL,
        "brokerUserId" uuid NOT NULL,
        "mobile" character varying(20) NOT NULL,
        "usedAt" TIMESTAMP,
        "revokedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_BrokerInvite" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_BrokerInvite_token" UNIQUE ("token"),
        CONSTRAINT "FK_BrokerInvite_company" FOREIGN KEY ("companyUserId") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_BrokerInvite_broker" FOREIGN KEY ("brokerUserId") REFERENCES "User"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_BrokerInvite_company" ON "BrokerInvite" ("companyUserId", "revokedAt")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_BrokerInvite_company_broker" ON "BrokerInvite" ("companyUserId", "brokerUserId")`);
    await queryRunner.query(`CREATE INDEX "IDX_BrokerInvite_mobile" ON "BrokerInvite" ("mobile")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "BrokerInvite"`);
  }
}
