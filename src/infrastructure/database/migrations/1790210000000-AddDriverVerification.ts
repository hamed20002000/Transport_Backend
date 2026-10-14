import { MigrationInterface, QueryRunner } from 'typeorm';

/** تاریخ تولد و نتیجه‌ی استعلام‌های api.ir برای تأیید مدارک راننده. */
export class AddDriverVerification1790210000000 implements MigrationInterface {
  name = 'AddDriverVerification1790210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD "birthDate" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD "verification" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN "verification"`);
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN "birthDate"`);
  }
}
