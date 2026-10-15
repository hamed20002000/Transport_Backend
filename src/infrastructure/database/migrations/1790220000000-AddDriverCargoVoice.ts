import { MigrationInterface, QueryRunner } from 'typeorm';

/** روشن/خاموش کردن خواندن صوتی بارهای اعلام‌شده برای راننده (پیش‌فرض روشن). */
export class AddDriverCargoVoice1790220000000 implements MigrationInterface {
  name = 'AddDriverCargoVoice1790220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD "cargoVoice" boolean NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN "cargoVoice"`);
  }
}
