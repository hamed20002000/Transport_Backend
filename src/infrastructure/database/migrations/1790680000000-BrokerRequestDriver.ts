import { MigrationInterface, QueryRunner } from 'typeorm';

/** درخواست بار واسط برای یک راننده: مشخصات راننده همراه درخواست (بی‌ساختن حساب برایش). */
export class BrokerRequestDriver1790680000000 implements MigrationInterface {
  name = 'BrokerRequestDriver1790680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD COLUMN IF NOT EXISTS "forDriver" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN IF EXISTS "forDriver"`);
  }
}
