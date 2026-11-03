import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The notices one messenger message carries (a load, or a summary of several) are found by the chat they went to
 * (CargoNotificationRepository.findByMessage), on every edit of a load's messages: an index per messenger's chat.
 */
export class CargoNotificationChatIndexes1790630000000 implements MigrationInterface {
  name = 'CargoNotificationChatIndexes1790630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const messenger of ['telegram', 'bale', 'rubika', 'eitaa']) {
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_CargoNotification_${messenger}Chat" ON "CargoNotification" ("${messenger}ChatId") WHERE "${messenger}ChatId" IS NOT NULL`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_CargoNotification_whatsappChat" ON "CargoNotification" (("whatsappMessageKey" ->> 'remoteJid')) WHERE "whatsappMessageKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const messenger of ['telegram', 'bale', 'rubika', 'eitaa', 'whatsapp']) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_CargoNotification_${messenger}Chat"`);
    }
  }
}
