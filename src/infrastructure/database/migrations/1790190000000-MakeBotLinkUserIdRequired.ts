import { MigrationInterface, QueryRunner } from 'typeorm';

/** اتصال پیام‌رسان بدون کاربر سامانه ساخته نمی‌شود؛ userId اجباری می‌شود. */
export class MakeBotLinkUserIdRequired1790190000000 implements MigrationInterface {
  name = 'MakeBotLinkUserIdRequired1790190000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "BotLink" ALTER COLUMN "userId" SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "BotLink" ALTER COLUMN "userId" DROP NOT NULL`);
  }
}
