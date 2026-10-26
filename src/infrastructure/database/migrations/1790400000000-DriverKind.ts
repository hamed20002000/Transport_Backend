import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A driver is either domestic or international (DriverKind): an international driver takes both export and import
 * loads. Drivers saved with export or import become international (both types); the rest domestic.
 * Before, a driver could pick any mix of the three; the mix cannot come back, so down() leaves the data.
 */
export class DriverKind1790400000000 implements MigrationInterface {
  name = 'DriverKind1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "DriverProfile"
         SET "tripTypes" = ARRAY['EXPORT', 'IMPORT']::varchar[], "tripType" = 'EXPORT'
       WHERE "tripTypes" && ARRAY['EXPORT', 'IMPORT']::varchar[] OR "tripType" IN ('EXPORT', 'IMPORT')`);
    await queryRunner.query(`
      UPDATE "DriverProfile"
         SET "tripTypes" = ARRAY['DOMESTIC']::varchar[], "tripType" = 'DOMESTIC'
       WHERE NOT ("tripTypes" && ARRAY['EXPORT', 'IMPORT']::varchar[]) AND "tripType" NOT IN ('EXPORT', 'IMPORT')`);
  }

  public async down(): Promise<void> {
    // the earlier mix of types is not kept
  }
}
