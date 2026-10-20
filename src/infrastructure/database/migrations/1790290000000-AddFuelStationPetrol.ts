import { MigrationInterface, QueryRunner } from 'typeorm';

/** بنزین جایگاه‌ها (از تگ‌های octane/gasoline در OpenStreetMap) تا راننده نوع سوخت را انتخاب کند. */
export class AddFuelStationPetrol1790290000000 implements MigrationInterface {
  name = 'AddFuelStationPetrol1790290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "FuelStation" ADD COLUMN IF NOT EXISTS "petrol" boolean`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "FuelStation" DROP COLUMN IF EXISTS "petrol"`);
  }
}
