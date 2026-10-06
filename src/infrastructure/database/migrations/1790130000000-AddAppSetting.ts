import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AppSetting: تنظیمات زمان اجرا. اولین کاربرد: سیاست اشتراک (اجباری بودن و
 * دوره‌ی رایگان) که ادمین بدون ری‌استارت تغییرش می‌دهد. بدون ردیف = اشتراک اجباری نیست.
 */
export class AddAppSetting1790130000000 implements MigrationInterface {
  name = 'AddAppSetting1790130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "AppSetting" (
        "key" character varying(100) NOT NULL,
        "value" jsonb NOT NULL,
        "updatedByUserId" uuid,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_AppSetting_key" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "AppSetting"`);
  }
}
