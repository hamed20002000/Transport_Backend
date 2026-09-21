import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionEntities1790003165334
  implements MigrationInterface
{
  name = 'AddSubscriptionEntities1790003165334';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * ============================================================
     * SubscriptionPlan
     * ============================================================
     */

    await queryRunner.query(`
      CREATE TYPE "public"."SubscriptionPlan_accounttype_enum"
      AS ENUM ('DRIVER', 'COMPANY', 'BROKER')
    `);

    await queryRunner.query(`
      CREATE TABLE "SubscriptionPlan" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(150) NOT NULL,
        "accountType" "public"."SubscriptionPlan_accounttype_enum" NOT NULL,
        "durationDays" integer NOT NULL,
        "price" bigint NOT NULL,
        "currency" character varying(10) NOT NULL DEFAULT 'IRR',
        "recordStatus" smallint NOT NULL DEFAULT '0',
        "sortOrder" integer NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_2a96f422dd8968c2461b60c0fae"
          PRIMARY KEY ("id")
      )
    `);

    /*
     * ============================================================
     * SubscriptionOrder
     * ============================================================
     */

    await queryRunner.query(`
      CREATE TYPE "public"."SubscriptionOrder_provider_enum"
      AS ENUM ('TELEGRAM', 'WHATSAPP')
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."SubscriptionOrder_accounttype_enum"
      AS ENUM ('DRIVER', 'COMPANY', 'BROKER')
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."SubscriptionOrder_status_enum"
      AS ENUM (
        'WAITING_FOR_RECEIPT',
        'RECEIPT_SUBMITTED',
        'UNDER_REVIEW',
        'APPROVED',
        'REJECTED',
        'CANCELLED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "SubscriptionOrder" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" "public"."SubscriptionOrder_provider_enum" NOT NULL,
        "providerUserId" character varying(150) NOT NULL,
        "phoneNumber" character varying(20) NOT NULL,
        "accountType" "public"."SubscriptionOrder_accounttype_enum" NOT NULL,
        "subscriptionPlanId" uuid NOT NULL,
        "amount" bigint NOT NULL,
        "currency" character varying(10) NOT NULL DEFAULT 'IRR',
        "status" "public"."SubscriptionOrder_status_enum"
          NOT NULL DEFAULT 'WAITING_FOR_RECEIPT',
        "createdUserId" uuid,
        "approvedAt" TIMESTAMP,
        "approvedByUserId" uuid,
        "rejectedAt" TIMESTAMP,
        "rejectionReason" character varying(500),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_cc7e4922289b5bcf2414ffa3a64"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_ff7aaae23e2ffbc5f361ce20e9"
      ON "SubscriptionOrder" ("providerUserId")
    `);

    /*
     * ============================================================
     * PaymentReceipt
     * ============================================================
     */

    await queryRunner.query(`
      CREATE TYPE "public"."PaymentReceipt_status_enum"
      AS ENUM (
        'PENDING_ANALYSIS',
        'ANALYZED',
        'NEEDS_REVIEW',
        'APPROVED',
        'REJECTED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "PaymentReceipt" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "orderId" uuid NOT NULL,
        "providerFileId" character varying(500),
        "imageUrl" text NOT NULL,
        "status" "public"."PaymentReceipt_status_enum"
          NOT NULL DEFAULT 'PENDING_ANALYSIS',
        "extractedAmount" bigint,
        "trackingCode" character varying(100),
        "transactionDate" character varying(50),
        "transactionTime" character varying(20),
        "sourceCard" character varying(30),
        "destinationCard" character varying(30),
        "extractedPaymentStatus" character varying(30),
        "aiConfidence" numeric(5,4),
        "amountMatched" boolean,
        "destinationCardMatched" boolean,
        "duplicateTrackingCode" boolean,
        "aiRawResult" jsonb,
        "analyzedAt" TIMESTAMP,
        "reviewedByUserId" uuid,
        "reviewedAt" TIMESTAMP,
        "reviewNote" character varying(500),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_7bbc3d85fd9cd05ee7ef05f693e"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_4d860a5855ea42a07005b594cf"
      ON "PaymentReceipt" ("trackingCode")
    `);

    /*
     * ============================================================
     * Subscription
     * ============================================================
     */

    await queryRunner.query(`
      CREATE TYPE "public"."Subscription_status_enum"
      AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED')
    `);

    await queryRunner.query(`
      CREATE TABLE "Subscription" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "subscriptionPlanId" uuid NOT NULL,
        "orderId" uuid NOT NULL,
        "startAt" TIMESTAMP NOT NULL,
        "expireAt" TIMESTAMP NOT NULL,
        "status" "public"."Subscription_status_enum"
          NOT NULL DEFAULT 'ACTIVE',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_eb0d69496fa84cd24da9fc78edd"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_3ec3c4ae3f6a98ecfcdbf615cf"
      ON "Subscription" ("userId")
    `);

    /*
     * ============================================================
     * User
     * ============================================================
     */

    await queryRunner.query(`
      ALTER TABLE "User"
      ADD COLUMN "mustChangePassword"
      boolean NOT NULL DEFAULT false
    `);

    /*
     * ============================================================
     * TelegramLink
     *
     * OLD:
     * Id
     * ChatId
     * LastVerifiedAt
     * CurrentSessionId
     * Userid
     *
     * NEW:
     * id
     * telegramUserId
     * chatId
     * userId
     * telegramUsername
     * firstName
     * lastName
     * lastInteractionAt
     * createdAt
     * updatedAt
     * ============================================================
     */

    /*
     * ابتدا ستون‌های جدید nullable ایجاد می‌شوند تا رکوردهای قدیمی
     * باعث شکست migration نشوند.
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "new_id"
      uuid DEFAULT uuid_generate_v4()
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "telegramUserId"
      character varying(100)
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "chatId"
      character varying(100)
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "userId"
      uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "telegramUsername"
      character varying(100)
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "firstName"
      character varying(150)
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "lastName"
      character varying(150)
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "lastInteractionAt"
      TIMESTAMP
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "createdAt"
      TIMESTAMP NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "updatedAt"
      TIMESTAMP NOT NULL DEFAULT now()
    `);

    /*
     * انتقال داده‌های قدیمی
     */

    await queryRunner.query(`
      UPDATE "TelegramLink"
      SET
        "new_id" = COALESCE("Id", uuid_generate_v4()),
        "telegramUserId" = "ChatId"::text,
        "chatId" = "ChatId"::text,
        "lastInteractionAt" = "LastVerifiedAt"
    `);

    /*
     * Userid قدیمی varchar است.
     * فقط UUID معتبر به userId جدید منتقل می‌شود.
     */

    await queryRunner.query(`
      UPDATE "TelegramLink"
      SET "userId" =
        CASE
          WHEN "Userid" ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN "Userid"::uuid
          ELSE NULL
        END
    `);

    /*
     * PK قدیمی
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP CONSTRAINT IF EXISTS "PK_afff5372064277b96257bba2174"
    `);

    /*
     * حذف ستون‌های قدیمی
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "Id"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "ChatId"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "LastVerifiedAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "CurrentSessionId"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "Userid"
    `);

    /*
     * new_id → id
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      RENAME COLUMN "new_id" TO "id"
    `);

    /*
     * NOT NULL مطابق Entity جدید
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ALTER COLUMN "id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ALTER COLUMN "telegramUserId" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ALTER COLUMN "chatId" SET NOT NULL
    `);

    /*
     * Primary Key جدید
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD CONSTRAINT "PK_9ef6c151e5df6d4385471d90aab"
      PRIMARY KEY ("id")
    `);

    /*
     * Unique constraints مطابق Entity
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD CONSTRAINT "UQ_08ec8d22d412df3f5b1ef0a9c6e"
      UNIQUE ("telegramUserId")
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD CONSTRAINT "UQ_2e5c581313dc53ffca088f67b56"
      UNIQUE ("userId")
    `);

    /*
     * ============================================================
     * Foreign Keys
     * ============================================================
     */

    await queryRunner.query(`
      ALTER TABLE "SubscriptionOrder"
      ADD CONSTRAINT "FK_fa7068637f9090e9e8d6c1601f5"
      FOREIGN KEY ("subscriptionPlanId")
      REFERENCES "SubscriptionPlan"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "PaymentReceipt"
      ADD CONSTRAINT "FK_571b8a1e87a9e0994d972a21016"
      FOREIGN KEY ("orderId")
      REFERENCES "SubscriptionOrder"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "Subscription"
      ADD CONSTRAINT "FK_3ec3c4ae3f6a98ecfcdbf615cf4"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "Subscription"
      ADD CONSTRAINT "FK_4c97e2fa7fa1142f7bbf5b3ed98"
      FOREIGN KEY ("subscriptionPlanId")
      REFERENCES "SubscriptionPlan"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "Subscription"
      ADD CONSTRAINT "FK_5aa4a6df4de0ccee9b2bd98e3f2"
      FOREIGN KEY ("orderId")
      REFERENCES "SubscriptionOrder"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);

    /*
     * فقط userIdهایی که واقعاً User معتبر دارند نگه می‌داریم،
     * تا اضافه کردن FK به خاطر داده قدیمی fail نشود.
     */

    await queryRunner.query(`
      UPDATE "TelegramLink" tl
      SET "userId" = NULL
      WHERE "userId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "User" u
          WHERE u."id" = tl."userId"
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD CONSTRAINT "FK_2e5c581313dc53ffca088f67b56"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * ============================================================
     * Foreign Keys
     * ============================================================
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP CONSTRAINT IF EXISTS "FK_2e5c581313dc53ffca088f67b56"
    `);

    await queryRunner.query(`
      ALTER TABLE "Subscription"
      DROP CONSTRAINT IF EXISTS "FK_5aa4a6df4de0ccee9b2bd98e3f2"
    `);

    await queryRunner.query(`
      ALTER TABLE "Subscription"
      DROP CONSTRAINT IF EXISTS "FK_4c97e2fa7fa1142f7bbf5b3ed98"
    `);

    await queryRunner.query(`
      ALTER TABLE "Subscription"
      DROP CONSTRAINT IF EXISTS "FK_3ec3c4ae3f6a98ecfcdbf615cf4"
    `);

    await queryRunner.query(`
      ALTER TABLE "PaymentReceipt"
      DROP CONSTRAINT IF EXISTS "FK_571b8a1e87a9e0994d972a21016"
    `);

    await queryRunner.query(`
      ALTER TABLE "SubscriptionOrder"
      DROP CONSTRAINT IF EXISTS "FK_fa7068637f9090e9e8d6c1601f5"
    `);

    /*
     * ============================================================
     * TelegramLink → ساختار قدیمی
     * ============================================================
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP CONSTRAINT IF EXISTS "UQ_2e5c581313dc53ffca088f67b56"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP CONSTRAINT IF EXISTS "UQ_08ec8d22d412df3f5b1ef0a9c6e"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP CONSTRAINT IF EXISTS "PK_9ef6c151e5df6d4385471d90aab"
    `);

    /*
     * ستون‌های قدیمی را دوباره ایجاد می‌کنیم.
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "OldId"
      uuid DEFAULT uuid_generate_v4()
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "OldChatId"
      bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "LastVerifiedAt"
      TIMESTAMP NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "CurrentSessionId"
      character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD COLUMN "Userid"
      character varying
    `);

    /*
     * برگرداندن داده‌هایی که قابل برگشت هستند.
     */

    await queryRunner.query(`
      UPDATE "TelegramLink"
      SET
        "OldId" = "id",
        "OldChatId" =
          CASE
            WHEN "chatId" ~ '^[0-9]+$'
            THEN "chatId"::bigint
            ELSE 0
          END,
        "LastVerifiedAt" =
          COALESCE("lastInteractionAt", "updatedAt", now()),
        "Userid" =
          COALESCE("userId"::text, '')
    `);

    /*
     * حذف ستون‌های جدید
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "updatedAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "createdAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "lastInteractionAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "lastName"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "firstName"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "telegramUsername"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "userId"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "chatId"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "telegramUserId"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      DROP COLUMN "id"
    `);

    /*
     * نام ستون‌های قدیمی
     */

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      RENAME COLUMN "OldId" TO "Id"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      RENAME COLUMN "OldChatId" TO "ChatId"
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ALTER COLUMN "Id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ALTER COLUMN "ChatId" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ALTER COLUMN "Userid" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "TelegramLink"
      ADD CONSTRAINT "PK_afff5372064277b96257bba2174"
      PRIMARY KEY ("Id")
    `);

    /*
     * ============================================================
     * User
     * ============================================================
     */

    await queryRunner.query(`
      ALTER TABLE "User"
      DROP COLUMN IF EXISTS "mustChangePassword"
    `);

    /*
     * ============================================================
     * Subscription
     * ============================================================
     */

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_3ec3c4ae3f6a98ecfcdbf615cf"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "Subscription"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."Subscription_status_enum"
    `);

    /*
     * ============================================================
     * PaymentReceipt
     * ============================================================
     */

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_4d860a5855ea42a07005b594cf"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "PaymentReceipt"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."PaymentReceipt_status_enum"
    `);

    /*
     * ============================================================
     * SubscriptionOrder
     * ============================================================
     */

    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_ff7aaae23e2ffbc5f361ce20e9"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "SubscriptionOrder"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."SubscriptionOrder_status_enum"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."SubscriptionOrder_accounttype_enum"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."SubscriptionOrder_provider_enum"
    `);

    /*
     * ============================================================
     * SubscriptionPlan
     * ============================================================
     */

    await queryRunner.query(`
      DROP TABLE IF EXISTS "SubscriptionPlan"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "public"."SubscriptionPlan_accounttype_enum"
    `);
  }
}