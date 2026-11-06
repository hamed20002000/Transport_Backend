import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One trip per load: at most one request of a load is ACCEPTED or DELIVERED. Two «قبول» of different requests of the
 * same load at the same moment (bot and web) both passed the «still open» check; the second save now fails and is
 * answered «taken» (CargoTripService). OFFERED is left out: an offer past its time stays OFFERED until it is expired.
 */
export class CargoRequestOneTrip1790800000000 implements MigrationInterface {
  name = 'CargoRequestOneTrip1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_CargoRequest_listing_trip"
        ON "CargoRequest" ("listingId") WHERE "status" IN ('ACCEPTED', 'DELIVERED')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_CargoRequest_listing_trip"`);
  }
}
