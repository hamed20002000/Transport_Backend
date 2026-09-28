import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCargoDeliveryRetry1790060000000 implements MigrationInterface {
  name = 'AddCargoDeliveryRetry1790060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "CargoNotification"
      ADD COLUMN "telegramAttempts" integer NOT NULL DEFAULT 0,
      ADD COLUMN "telegramNextRetryAt" TIMESTAMP,
      ADD COLUMN "whatsappAttempts" integer NOT NULL DEFAULT 0,
      ADD COLUMN "whatsappNextRetryAt" TIMESTAMP
    `);

    // The retry worker only scans recent notifications.
    await queryRunner.query(`
      CREATE INDEX "IDX_CargoNotification_createdAt" ON "CargoNotification" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_CargoNotification_createdAt"`);
    await queryRunner.query(`
      ALTER TABLE "CargoNotification"
      DROP COLUMN "whatsappNextRetryAt",
      DROP COLUMN "whatsappAttempts",
      DROP COLUMN "telegramNextRetryAt",
      DROP COLUMN "telegramAttempts"
    `);
  }
}
