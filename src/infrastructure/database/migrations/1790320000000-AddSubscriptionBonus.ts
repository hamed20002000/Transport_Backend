import { MigrationInterface, QueryRunner } from 'typeorm';

/** روزهای رایگان هدیه (مثلاً به راننده‌ای که جمع خریدش از یک مبلغ گذشته)، جدا از اشتراک خریده‌شده. */
export class AddSubscriptionBonus1790320000000 implements MigrationInterface {
  name = 'AddSubscriptionBonus1790320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "SubscriptionBonus" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "reason" character varying(64) NOT NULL,
        "days" integer NOT NULL,
        "startAt" TIMESTAMP NOT NULL,
        "expireAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_SubscriptionBonus_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_SubscriptionBonus_user_reason" UNIQUE ("userId", "reason"),
        CONSTRAINT "FK_SubscriptionBonus_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_SubscriptionBonus_user_expire" ON "SubscriptionBonus" ("userId", "expireAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "SubscriptionBonus"`);
  }
}
