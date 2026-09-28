import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCargoNotifications1790040000000 implements MigrationInterface {
  name = 'AddCargoNotifications1790040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "CargoAlertFilter" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "label" character varying(150),
        "origins" text array NOT NULL DEFAULT '{}',
        "destinations" text array NOT NULL DEFAULT '{}',
        "cargoTypes" text array NOT NULL DEFAULT '{}',
        "vehicleTypes" text array NOT NULL DEFAULT '{}',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CargoAlertFilter_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_CargoAlertFilter_userId" FOREIGN KEY ("userId")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_CargoAlertFilter_userId" ON "CargoAlertFilter" ("userId")
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."CargoNotification_telegramstatus_enum"
        AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED')
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."CargoNotification_whatsappstatus_enum"
        AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED')
    `);

    await queryRunner.query(`
      CREATE TABLE "CargoNotification" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "sourceMessageId" character varying(100) NOT NULL,
        "text" text NOT NULL,
        "payload" jsonb NOT NULL,
        "isRead" boolean NOT NULL DEFAULT false,
        "readAt" TIMESTAMP,
        "telegramStatus" "public"."CargoNotification_telegramstatus_enum" NOT NULL DEFAULT 'PENDING',
        "whatsappStatus" "public"."CargoNotification_whatsappstatus_enum" NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CargoNotification_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_CargoNotification_userId" FOREIGN KEY ("userId")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_CargoNotification_message_user"
      ON "CargoNotification" ("sourceMessageId", "userId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_CargoNotification_user_read_created"
      ON "CargoNotification" ("userId", "isRead", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "CargoNotification"`);
    await queryRunner.query(`DROP TYPE "public"."CargoNotification_whatsappstatus_enum"`);
    await queryRunner.query(`DROP TYPE "public"."CargoNotification_telegramstatus_enum"`);
    await queryRunner.query(`DROP TABLE "CargoAlertFilter"`);
  }
}
