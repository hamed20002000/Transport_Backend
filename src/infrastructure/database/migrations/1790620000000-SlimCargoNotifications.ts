import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A driver's notice of a published load no longer keeps a copy of the load's text and details (they are read from
 * "CargoListing"); the copies already stored are emptied. Not reversible: the load still has them.
 */
export class SlimCargoNotifications1790620000000 implements MigrationInterface {
  name = 'SlimCargoNotifications1790620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "CargoNotification" SET "text" = '', "payload" = '{}' WHERE "listingId" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "CargoNotification" n SET "text" = l."text"
        FROM "CargoListing" l
       WHERE l.id = n."listingId"`);
  }
}
