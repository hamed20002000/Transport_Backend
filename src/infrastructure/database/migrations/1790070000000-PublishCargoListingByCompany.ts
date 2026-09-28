import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CargoListing دیگر هنگام رسیدن پیام ساخته نمی‌شود؛ فقط وقتی شرکت بار را به
 * نام خودش برای راننده‌ها منتشر کند. ردیف‌های قبلی این جدول در مدل جدید
 * معنایی ندارند، پس جدول از نو ساخته می‌شود.
 */
export class PublishCargoListingByCompany1790070000000 implements MigrationInterface {
  name = 'PublishCargoListingByCompany1790070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "CargoListing"`);

    await queryRunner.query(`
      CREATE TABLE "CargoListing" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sourceMessageId" character varying(100) NOT NULL,
        "sourceNotificationId" uuid,
        "publisherUserId" uuid NOT NULL,
        "companyId" uuid,
        "companyName" character varying(200),
        "origin" character varying(200) NOT NULL,
        "destination" character varying(200) NOT NULL,
        "cargoType" character varying(200),
        "weight" character varying(100),
        "vehicleType" character varying(200),
        "price" character varying(100),
        "extraNotes" text,
        "contactPhones" text array NOT NULL DEFAULT '{}',
        "text" text NOT NULL,
        "status" "public"."CargoListing_status_enum" NOT NULL DEFAULT 'OPEN',
        "takenAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CargoListing_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_CargoListing_publisherUserId" FOREIGN KEY ("publisherUserId")
          REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_CargoListing_companyId" FOREIGN KEY ("companyId")
          REFERENCES "TransportCompany"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_CargoListing_source_publisher"
      ON "CargoListing" ("sourceMessageId", "publisherUserId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_CargoListing_publisher_created"
      ON "CargoListing" ("publisherUserId", "createdAt")
    `);

    await queryRunner.query(`
      ALTER TABLE "CargoNotification"
      ADD COLUMN "listingId" uuid,
      ADD CONSTRAINT "FK_CargoNotification_listingId" FOREIGN KEY ("listingId")
        REFERENCES "CargoListing"("id") ON DELETE CASCADE
    `);

    // A driver can receive the same source cargo from two companies, so the
    // company-suggestion key only applies to rows without a listing.
    await queryRunner.query(`DROP INDEX "public"."UQ_CargoNotification_message_user"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_CargoNotification_message_user"
      ON "CargoNotification" ("sourceMessageId", "userId")
      WHERE "listingId" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_CargoNotification_listing_user"
      ON "CargoNotification" ("listingId", "userId")
      WHERE "listingId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "CargoNotification" WHERE "listingId" IS NOT NULL`);
    await queryRunner.query(`DROP INDEX "public"."UQ_CargoNotification_listing_user"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_CargoNotification_message_user"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_CargoNotification_message_user"
      ON "CargoNotification" ("sourceMessageId", "userId")
    `);
    await queryRunner.query(`
      ALTER TABLE "CargoNotification"
      DROP CONSTRAINT "FK_CargoNotification_listingId",
      DROP COLUMN "listingId"
    `);

    await queryRunner.query(`DROP TABLE "CargoListing"`);
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
      CREATE UNIQUE INDEX "UQ_CargoListing_sourceMessageId" ON "CargoListing" ("sourceMessageId")
    `);
  }
}
