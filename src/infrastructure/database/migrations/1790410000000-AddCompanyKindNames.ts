import { MigrationInterface, QueryRunner } from 'typeorm';

/** A company's optional names for domestic and for international work; drivers pick companies under each kind. */
export class AddCompanyKindNames1790410000000 implements MigrationInterface {
  name = 'AddCompanyKindNames1790410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "domesticCompanyName" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "internationalCompanyName" character varying(200)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "internationalCompanyName"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "domesticCompanyName"`);
  }
}
