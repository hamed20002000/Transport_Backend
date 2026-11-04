import { MigrationInterface, QueryRunner } from 'typeorm';

/** راننده‌ای که شرکت مادر مستقیم (بی‌لینک و پیامک) ثبتش کرد: ردیف دعوتش همان لحظه «وارد شده» است. */
export class DriverInviteDirect1790740000000 implements MigrationInterface {
  name = 'DriverInviteDirect1790740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverInvite" ADD COLUMN IF NOT EXISTS "direct" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverInvite" DROP COLUMN IF EXISTS "direct"`);
  }
}
