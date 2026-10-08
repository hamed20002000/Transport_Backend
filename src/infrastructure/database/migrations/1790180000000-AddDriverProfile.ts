import { MigrationInterface, QueryRunner } from 'typeorm';

/** مدارک، ناوگان و عکس‌های اختیاری راننده. */
export class AddDriverProfile1790180000000 implements MigrationInterface {
  name = 'AddDriverProfile1790180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "DriverProfile" (
        "userId" uuid NOT NULL,
        "smartCardNumber" character varying(20),
        "licenseNumber" character varying(20),
        "homeCity" character varying(100),
        "vehicleType" character varying(100),
        "vehicleModel" character varying(100),
        "plate" character varying(20),
        "capacityTons" numeric(5,1),
        "fleetCardNumber" character varying(20),
        "vehiclePhoto" character varying(60),
        "platePhoto" character varying(60),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_DriverProfile_userId" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_DriverProfile_userId" FOREIGN KEY ("userId")
          REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "DriverProfile"`);
  }
}
