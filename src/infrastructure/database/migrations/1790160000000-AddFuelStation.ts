import { MigrationInterface, QueryRunner } from 'typeorm';

/** جایگاه‌های سوخت ایران از OpenStreetMap (برای پمپ بنزین‌های مسیر بار). */
export class AddFuelStation1790160000000 implements MigrationInterface {
  name = 'AddFuelStation1790160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "FuelStation" (
        "id" character varying(30) NOT NULL,
        "name" character varying(200),
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "diesel" boolean,
        "cng" boolean,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_FuelStation_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_FuelStation_lat_lng" ON "FuelStation" ("latitude", "longitude")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "FuelStation"`);
  }
}
