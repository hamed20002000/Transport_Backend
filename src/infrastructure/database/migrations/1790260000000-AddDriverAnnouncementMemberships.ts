import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDriverAnnouncementMemberships1790260000000 implements MigrationInterface {
  name = 'AddDriverAnnouncementMemberships1790260000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile"
      ADD COLUMN "tripTypes" varchar[] NOT NULL DEFAULT ARRAY['DOMESTIC']::varchar[],
      ADD COLUMN "companyUserIds" uuid[] NOT NULL DEFAULT '{}'::uuid[]`);
    await queryRunner.query(`UPDATE "DriverProfile" SET "tripTypes" = ARRAY["tripType"]::varchar[]`);
    await queryRunner.query(`CREATE INDEX "IDX_DriverProfile_companyUserIds" ON "DriverProfile" USING gin ("companyUserIds")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_DriverProfile_companyUserIds"`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN "companyUserIds", DROP COLUMN "tripTypes"`);
  }
}
