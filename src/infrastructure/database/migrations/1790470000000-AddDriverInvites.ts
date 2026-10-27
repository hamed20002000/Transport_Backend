import { MigrationInterface, QueryRunner } from 'typeorm';

/** دعوت شخصی راننده‌ها از طرف شرکت‌های حمل‌ونقل (تکی یا چندتایی)، مثل دعوت کارخانه و شرکت. */
export class AddDriverInvites1790470000000 implements MigrationInterface {
  name = 'AddDriverInvites1790470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "DriverInvite" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "token" character varying(64) NOT NULL,
        "companyUserId" uuid NOT NULL,
        "driverUserId" uuid NOT NULL,
        "mobile" character varying(20) NOT NULL,
        "usedAt" TIMESTAMP,
        "revokedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_DriverInvite_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_DriverInvite_token" UNIQUE ("token"),
        CONSTRAINT "FK_DriverInvite_company" FOREIGN KEY ("companyUserId") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_DriverInvite_driver" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_DriverInvite_company" ON "DriverInvite" ("companyUserId", "revokedAt")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_DriverInvite_company_driver" ON "DriverInvite" ("companyUserId", "driverUserId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "DriverInvite"`);
  }
}
