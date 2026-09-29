import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * هر domain agent مشخص می‌کند برای چه نقش‌هایی است (COMPANY، DRIVER، ...).
 * انتخاب domain فقط بین domainهای نقش کاربر انجام می‌شود؛ domain بدون نقش
 * برای هیچ کاربری دیده نمی‌شود.
 */
export class AddToolDomainRoles1790090000000 implements MigrationInterface {
  name = 'AddToolDomainRoles1790090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ToolDomain" ADD COLUMN "Roles" text[] NOT NULL DEFAULT '{}'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ToolDomain" DROP COLUMN "Roles"`);
  }
}
