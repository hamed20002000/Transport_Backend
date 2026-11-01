import { MigrationInterface, QueryRunner } from 'typeorm';

/** موبایل‌هایی که بارهای اعلام‌شده نشان می‌دهند، با کاما جدا (خالی: همان موبایل ورود). */
export class AddContactMobile1790560000000 implements MigrationInterface {
  name = 'AddContactMobile1790560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contactMobiles" varchar(100)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "contactMobiles"`);
  }
}
