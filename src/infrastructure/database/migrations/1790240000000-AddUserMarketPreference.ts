import { MigrationInterface, QueryRunner } from 'typeorm';

/** ارزها و طلای انتخابی هر کاربر برای نوار قیمت. */
export class AddUserMarketPreference1790240000000 implements MigrationInterface {
  name = 'AddUserMarketPreference1790240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserMarketPreference" (
        "userId" uuid NOT NULL,
        "symbols" text array NOT NULL DEFAULT '{}',
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_UserMarketPreference" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_UserMarketPreference_userId" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "UserMarketPreference"`);
  }
}
