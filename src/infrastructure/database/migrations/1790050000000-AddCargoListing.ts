import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCargoListing1790050000000 implements MigrationInterface {
  name = 'AddCargoListing1790050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."CargoListing_status_enum" AS ENUM ('OPEN', 'TAKEN')
    `);

    await queryRunner.query(`
      CREATE TABLE "CargoListing" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sourceMessageId" character varying(100) NOT NULL,
        "status" "public"."CargoListing_status_enum" NOT NULL DEFAULT 'OPEN',
        "takenAt" TIMESTAMP,
        "takenByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CargoListing_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_CargoListing_takenByUserId" FOREIGN KEY ("takenByUserId")
          REFERENCES "User"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_CargoListing_sourceMessageId"
      ON "CargoListing" ("sourceMessageId")
    `);

    // بارهایی که قبل از این migration اعلان گرفته‌اند هم ردیف وضعیت داشته باشند.
    await queryRunner.query(`
      INSERT INTO "CargoListing" ("sourceMessageId")
      SELECT DISTINCT "sourceMessageId" FROM "CargoNotification"
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE "CargoNotification"
      ADD COLUMN "telegramChatId" character varying(100),
      ADD COLUMN "telegramMessageId" integer,
      ADD COLUMN "whatsappMessageKey" jsonb,
      ADD COLUMN "whatsappSentAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "CargoNotification"
      DROP COLUMN "whatsappSentAt",
      DROP COLUMN "whatsappMessageKey",
      DROP COLUMN "telegramMessageId",
      DROP COLUMN "telegramChatId"
    `);
    await queryRunner.query(`DROP TABLE "CargoListing"`);
    await queryRunner.query(`DROP TYPE "public"."CargoListing_status_enum"`);
  }
}
