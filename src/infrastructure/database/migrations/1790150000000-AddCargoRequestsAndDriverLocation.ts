import { MigrationInterface, QueryRunner } from 'typeorm';

/** درخواست راننده برای بار (و سفر فعال) و آخرین موقعیت راننده. */
export class AddCargoRequestsAndDriverLocation1790150000000 implements MigrationInterface {
  name = 'AddCargoRequestsAndDriverLocation1790150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "CargoRequest" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "listingId" uuid NOT NULL,
        "driverUserId" uuid NOT NULL,
        "companyUserId" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "decidedAt" TIMESTAMP,
        "deliveredAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CargoRequest_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_CargoRequest_listingId" FOREIGN KEY ("listingId")
          REFERENCES "CargoListing"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_CargoRequest_driverUserId" FOREIGN KEY ("driverUserId")
          REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_CargoRequest_companyUserId" FOREIGN KEY ("companyUserId")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_CargoRequest_listing_driver" ON "CargoRequest" ("listingId", "driverUserId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_CargoRequest_driver_status" ON "CargoRequest" ("driverUserId", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_CargoRequest_company_status" ON "CargoRequest" ("companyUserId", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE "DriverLocation" (
        "userId" uuid NOT NULL,
        "latitude" double precision NOT NULL,
        "longitude" double precision NOT NULL,
        "liveUntil" TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_DriverLocation_userId" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_DriverLocation_userId" FOREIGN KEY ("userId")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "DriverLocation"`);
    await queryRunner.query(`DROP TABLE "CargoRequest"`);
  }
}
