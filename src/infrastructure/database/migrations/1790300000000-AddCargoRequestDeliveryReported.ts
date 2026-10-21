import { MigrationInterface, QueryRunner } from 'typeorm';

/** راننده تحویل را اعلام کرد و سفر منتظر تأیید شرکت است (تا تأیید، وضعیت ACCEPTED می‌ماند). */
export class AddCargoRequestDeliveryReported1790300000000 implements MigrationInterface {
  name = 'AddCargoRequestDeliveryReported1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD COLUMN IF NOT EXISTS "deliveryReportedAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN IF EXISTS "deliveryReportedAt"`);
  }
}
