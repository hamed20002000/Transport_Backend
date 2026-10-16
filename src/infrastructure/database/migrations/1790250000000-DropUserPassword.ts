import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ورود و ثبت‌نام فقط با شماره موبایل و کد پیامکی است؛ رمز عبور و «تغییر رمز در اولین ورود» دیگر نیست.
 * down ستون‌ها را برمی‌گرداند ولی رمزهای قبلی برنمی‌گردند (null می‌مانند).
 */
export class DropUserPassword1790250000000 implements MigrationInterface {
  name = 'DropUserPassword1790250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "passwordHash"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "mustChangePassword"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD "mustChangePassword" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "User" ADD "passwordHash" character varying(255)`);
  }
}
