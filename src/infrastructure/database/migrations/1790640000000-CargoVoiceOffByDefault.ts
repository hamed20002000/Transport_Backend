import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reading a load aloud in the messengers is off by default: a voice message there does not play by itself. Every
 * driver's goes off (which ones had turned it on themselves is not known); a driver turns it on in the bot's settings.
 */
export class CargoVoiceOffByDefault1790640000000 implements MigrationInterface {
  name = 'CargoVoiceOffByDefault1790640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ALTER COLUMN "cargoVoice" SET DEFAULT false`);
    await queryRunner.query(`UPDATE "DriverProfile" SET "cargoVoice" = false WHERE "cargoVoice" = true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ALTER COLUMN "cargoVoice" SET DEFAULT true`);
  }
}
