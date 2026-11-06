import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 09358016715 signs in to the parent company too (ParentCompanyLogin). The driver account the number had is removed
 * by hand on each database (a sign-in with it would never reach that account again).
 */
export class ParentCompanyLoginMehran1790810000000 implements MigrationInterface {
  name = 'ParentCompanyLoginMehran1790810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`INSERT INTO "ParentCompanyLogin" ("mobile") VALUES ('09358016715') ON CONFLICT ("mobile") DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "ParentCompanyLogin" WHERE "mobile" = '09358016715'`);
  }
}
