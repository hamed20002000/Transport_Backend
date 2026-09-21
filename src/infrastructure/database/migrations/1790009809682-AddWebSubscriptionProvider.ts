import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebSubscriptionProvider1790009809682
  implements MigrationInterface
{
  name = 'AddWebSubscriptionProvider1790009809682';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."SubscriptionOrder_provider_enum"
      ADD VALUE IF NOT EXISTS 'WEB'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot drop a single enum value. Rebuild the type only
    // when no orders use WEB, keeping the check and replacement atomic.
    await queryRunner.query(`
      DO $$
      BEGIN
        LOCK TABLE "public"."SubscriptionOrder" IN ACCESS EXCLUSIVE MODE;

        IF EXISTS (
          SELECT 1 FROM "public"."SubscriptionOrder"
          WHERE "provider"::text = 'WEB'
        ) THEN
          RAISE EXCEPTION 'Cannot remove WEB provider while WEB subscription orders exist';
        END IF;

        ALTER TYPE "public"."SubscriptionOrder_provider_enum"
          RENAME TO "SubscriptionOrder_provider_enum_with_web";

        CREATE TYPE "public"."SubscriptionOrder_provider_enum"
          AS ENUM ('TELEGRAM', 'WHATSAPP');

        ALTER TABLE "public"."SubscriptionOrder"
          ALTER COLUMN "provider"
          TYPE "public"."SubscriptionOrder_provider_enum"
          USING "provider"::text::"public"."SubscriptionOrder_provider_enum";

        DROP TYPE "public"."SubscriptionOrder_provider_enum_with_web";
      END
      $$;
    `);
  }
}
