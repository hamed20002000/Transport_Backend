import { MigrationInterface, QueryRunner } from 'typeorm';

/** موبایلی که بارهای اعلام‌شده نشان می‌دهند، وقتی غیر از موبایل ورود است (خالی: همان موبایل ورود). */
export class AddContactMobile1790560000000 implements MigrationInterface {
  name = 'AddContactMobile1790560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contactMobile" varchar(20)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "contactMobile"`);
  }
}
