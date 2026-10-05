import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TelegramLink اتصال هر سه پیام‌رسان (تلگرام، بله، روبیکا) را نگه می‌دارد؛
 * اسم جدول و ستون‌ها با entity (BotLink) یکی می‌شود:
 *   - TelegramLink → BotLink
 *   - telegramUserId → externalUserId، telegramUsername → externalUsername
 *   - اسم constraint ها همان اسمی که TypeORM برای جدول/ستون جدید می‌سازد
 */
export class RenameTelegramLinkToBotLink1790120000000 implements MigrationInterface {
  name = 'RenameTelegramLinkToBotLink1790120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "TelegramLink" RENAME TO "BotLink"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME COLUMN "telegramUserId" TO "externalUserId"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME COLUMN "telegramUsername" TO "externalUsername"`);

    await queryRunner.query(`ALTER TABLE "BotLink" RENAME CONSTRAINT "PK_9ef6c151e5df6d4385471d90aab" TO "PK_a1a921cd736219d60d0a320a7ef"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME CONSTRAINT "UQ_08ec8d22d412df3f5b1ef0a9c6e" TO "UQ_cca468609bb5f81c9c40a19a470"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME CONSTRAINT "FK_2e5c581313dc53ffca088f67b56" TO "FK_a4afd138ad796e7088d084bb843"`);
    await queryRunner.query(`ALTER INDEX "public"."UQ_TelegramLink_UserId_Platform" RENAME TO "UQ_BotLink_UserId_Platform"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER INDEX "public"."UQ_BotLink_UserId_Platform" RENAME TO "UQ_TelegramLink_UserId_Platform"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME CONSTRAINT "FK_a4afd138ad796e7088d084bb843" TO "FK_2e5c581313dc53ffca088f67b56"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME CONSTRAINT "UQ_cca468609bb5f81c9c40a19a470" TO "UQ_08ec8d22d412df3f5b1ef0a9c6e"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME CONSTRAINT "PK_a1a921cd736219d60d0a320a7ef" TO "PK_9ef6c151e5df6d4385471d90aab"`);

    await queryRunner.query(`ALTER TABLE "BotLink" RENAME COLUMN "externalUsername" TO "telegramUsername"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME COLUMN "externalUserId" TO "telegramUserId"`);
    await queryRunner.query(`ALTER TABLE "BotLink" RENAME TO "TelegramLink"`);
  }
}
