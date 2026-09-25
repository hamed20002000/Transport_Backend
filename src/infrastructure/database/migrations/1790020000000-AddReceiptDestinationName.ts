import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceiptDestinationName1790020000000
  implements MigrationInterface
{
  name = 'AddReceiptDestinationName1790020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "PaymentReceipt"
      ADD COLUMN IF NOT EXISTS "destinationName" character varying(150),
      ADD COLUMN IF NOT EXISTS "destinationNameMatched" boolean
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "PaymentReceipt"
      DROP COLUMN IF EXISTS "destinationNameMatched",
      DROP COLUMN IF EXISTS "destinationName"
    `);
  }
}
