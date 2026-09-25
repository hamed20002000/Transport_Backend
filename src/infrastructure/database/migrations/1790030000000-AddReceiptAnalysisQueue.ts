import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceiptAnalysisQueue1790030000000
  implements MigrationInterface
{
  name = 'AddReceiptAnalysisQueue1790030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."PaymentReceipt_status_enum"
      ADD VALUE IF NOT EXISTS 'ANALYZING'
    `);

    await queryRunner.query(`
      ALTER TABLE "PaymentReceipt"
      ADD COLUMN IF NOT EXISTS "analysisAttempts" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "analysisStartedAt" TIMESTAMP
    `);

    // The worker scans for pending/stuck receipts by status.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_PaymentReceipt_status_createdAt"
      ON "PaymentReceipt" ("status", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_PaymentReceipt_status_createdAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "PaymentReceipt"
      DROP COLUMN IF EXISTS "analysisStartedAt",
      DROP COLUMN IF EXISTS "analysisAttempts"
    `);

    // PostgreSQL cannot drop a single enum value; rebuild it after
    // moving any in-flight receipts back to the queue.
    await queryRunner.query(`
      DO $$
      BEGIN
        LOCK TABLE "public"."PaymentReceipt" IN ACCESS EXCLUSIVE MODE;

        UPDATE "public"."PaymentReceipt"
        SET "status" = 'PENDING_ANALYSIS'
        WHERE "status"::text = 'ANALYZING';

        ALTER TABLE "public"."PaymentReceipt"
          ALTER COLUMN "status" DROP DEFAULT;

        ALTER TYPE "public"."PaymentReceipt_status_enum"
          RENAME TO "PaymentReceipt_status_enum_with_analyzing";

        CREATE TYPE "public"."PaymentReceipt_status_enum"
          AS ENUM ('PENDING_ANALYSIS', 'ANALYZED', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED');

        ALTER TABLE "public"."PaymentReceipt"
          ALTER COLUMN "status"
          TYPE "public"."PaymentReceipt_status_enum"
          USING "status"::text::"public"."PaymentReceipt_status_enum";

        ALTER TABLE "public"."PaymentReceipt"
          ALTER COLUMN "status" SET DEFAULT 'PENDING_ANALYSIS';

        DROP TYPE "public"."PaymentReceipt_status_enum_with_analyzing";
      END
      $$;
    `);
  }
}
