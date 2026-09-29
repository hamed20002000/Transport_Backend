import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * اطلاعات شخصی/شرکتی کاربر؛ همه ستون‌ها nullable هستند تا ثبت‌نام بدون آن‌ها
 * انجام شود و کاربر بعداً از طریق پروفایل تکمیلشان کند.
 */
export class AddUserProfileFields1790080000000 implements MigrationInterface {
  name = 'AddUserProfileFields1790080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "User"
      ADD COLUMN "profileType" smallint,
      ADD COLUMN "firstName" character varying(100),
      ADD COLUMN "lastName" character varying(100),
      ADD COLUMN "nationalCode" character varying(10),
      ADD COLUMN "companyName" character varying(200),
      ADD COLUMN "companyNationalId" character varying(11),
      ADD COLUMN "economicCode" character varying(30),
      ADD COLUMN "registrationNo" character varying(30),
      ADD COLUMN "phone" character varying(20),
      ADD COLUMN "postalCode" character varying(10),
      ADD COLUMN "address" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "User"
      DROP COLUMN "address",
      DROP COLUMN "postalCode",
      DROP COLUMN "phone",
      DROP COLUMN "registrationNo",
      DROP COLUMN "economicCode",
      DROP COLUMN "companyNationalId",
      DROP COLUMN "companyName",
      DROP COLUMN "nationalCode",
      DROP COLUMN "lastName",
      DROP COLUMN "firstName",
      DROP COLUMN "profileType"
    `);
  }
}
