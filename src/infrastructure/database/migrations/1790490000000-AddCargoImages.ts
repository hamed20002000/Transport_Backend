import { MigrationInterface, QueryRunner } from 'typeorm';

/** نمایش تصویری بار: عکسی که شرکت یا کارخانه روی بار می‌گذارد، و انتخاب هر کاربر بین متنی و تصویری. */
export class AddCargoImages1790490000000 implements MigrationInterface {
  name = 'AddCargoImages1790490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cargoDisplay" character varying(10) NOT NULL DEFAULT 'TEXT'`);
    await queryRunner.query(`ALTER TABLE "CargoListing" ADD COLUMN IF NOT EXISTS "photo" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "FactoryCargo" ADD COLUMN IF NOT EXISTS "photo" character varying(64)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "FactoryCargo" DROP COLUMN IF EXISTS "photo"`);
    await queryRunner.query(`ALTER TABLE "CargoListing" DROP COLUMN IF EXISTS "photo"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "cargoDisplay"`);
  }
}
