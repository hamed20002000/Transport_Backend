import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * هر کاربر در هر لحظه فقط یک فیلتر بار فعال دارد. کاربرانی که چند فیلتر فعال داشتند:
 * فقط آخرین فیلتری که تغییر داده‌اند فعال می‌ماند.
 */
export class OneActiveCargoFilter1790270000000 implements MigrationInterface {
  name = 'OneActiveCargoFilter1790270000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "CargoAlertFilter" SET "isActive" = false
      WHERE "isActive" = true AND id NOT IN (
        SELECT DISTINCT ON ("userId") id FROM "CargoAlertFilter"
        WHERE "isActive" = true ORDER BY "userId", "updatedAt" DESC, "createdAt" DESC
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_CargoAlertFilter_oneActivePerUser" ON "CargoAlertFilter" ("userId") WHERE "isActive" = true`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_CargoAlertFilter_oneActivePerUser"`);
  }
}
