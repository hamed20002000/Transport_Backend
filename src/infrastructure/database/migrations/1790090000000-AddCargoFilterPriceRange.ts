import { MigrationInterface, QueryRunner } from 'typeorm';

/** بازه‌ی کرایه (تومان) برای فیلتر اعلان بار؛ null یعنی بدون حد. */
export class AddCargoFilterPriceRange1790090000000 implements MigrationInterface {
  name = 'AddCargoFilterPriceRange1790090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "CargoAlertFilter"
      ADD COLUMN "minPrice" bigint,
      ADD COLUMN "maxPrice" bigint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "CargoAlertFilter"
      DROP COLUMN "maxPrice",
      DROP COLUMN "minPrice"
    `);
  }
}
