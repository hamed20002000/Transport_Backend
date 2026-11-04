import { MigrationInterface, QueryRunner } from 'typeorm';

/** بخشنامه‌هایی که ادمین برای راننده‌ها بارگذاری می‌کند (با فایل اختیاری) و خبرش به همه‌ی راننده‌ها می‌رسد. */
export class Circulars1790760000000 implements MigrationInterface {
  name = 'Circulars1790760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "Circular" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(200) NOT NULL,
        "body" text,
        "fileName" character varying(80),
        "originalName" character varying(200),
        "mimeType" character varying(100),
        "size" integer,
        "recipients" integer NOT NULL DEFAULT 0,
        "notified" integer NOT NULL DEFAULT 0,
        "notifiedAt" TIMESTAMP,
        "createdByUserId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_Circular" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_Circular_createdAt" ON "Circular" ("createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "Circular"`);
  }
}
