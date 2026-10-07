import { MigrationInterface, QueryRunner } from 'typeorm';

/** نام شرکت‌هایی که راننده فقط بارهای آن‌ها را می‌خواهد؛ خالی یعنی همه. */
export class AddCargoFilterCompanies1790140000000 implements MigrationInterface {
  name = 'AddCargoFilterCompanies1790140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "CargoAlertFilter"
      ADD COLUMN "companies" text array NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "CargoAlertFilter"
      DROP COLUMN "companies"
    `);
  }
}
