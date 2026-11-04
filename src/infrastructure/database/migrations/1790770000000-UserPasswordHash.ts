import { MigrationInterface, QueryRunner } from 'typeorm';

/** رمز عبور (هش argon2) برای ورود ادمین با نام کاربری در آدرس جدای پنل مدیریت؛ بقیه‌ی حساب‌ها رمز ندارند. */
export class UserPasswordHash1790770000000 implements MigrationInterface {
  name = 'UserPasswordHash1790770000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" character varying(200)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash"`);
  }
}
