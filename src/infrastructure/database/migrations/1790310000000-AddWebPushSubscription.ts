import { MigrationInterface, QueryRunner } from 'typeorm';

/** اشتراک‌های اعلان سیستمی (Web Push) هر کاربر. */
export class AddWebPushSubscription1790310000000 implements MigrationInterface {
  name = 'AddWebPushSubscription1790310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "WebPushSubscription" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "endpoint" text NOT NULL,
        "p256dh" character varying(200) NOT NULL,
        "auth" character varying(100) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_WebPushSubscription_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_WebPushSubscription_endpoint" UNIQUE ("endpoint")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_WebPushSubscription_userId" ON "WebPushSubscription" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "WebPushSubscription"`);
  }
}
