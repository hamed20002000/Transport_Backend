import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * کد اختصاصی هر حساب (مثل کد اشتراک تاکسی تلفنی) برای شناختنش پای تلفن و در پنل‌ها: رقم اول نوع حساب است
 * (۱ راننده، ۲ شرکت حمل‌ونقل، ۳ شرکت/کارخانه، ۴ واسط) و بعدش شماره‌ی ترتیبی همان نوع، دست‌کم چهاررقمی
 * (۱۰۰۰۱، ۲۰۰۴۵؛ بعد از ۹۹۹۹ حساب از یک نوع، شش‌رقمی می‌شود).
 *
 * نقش حساب از چند جا ثبت می‌شود (ثبت‌نام، پیام‌رسان‌ها، دعوت‌ها، ادمین)؛ برای این‌که هیچ‌کدام کد را جا نیندازد،
 * کد را trigger روی UserRole می‌دهد، با اولین نقش حساب از همین چهار نوع.
 */
export class AddAccountCode1790500000000 implements MigrationInterface {
  name = 'AddAccountCode1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD COLUMN "accountCode" character varying(10)`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_User_accountCode" ON "User" ("accountCode")`);
    for (const type of ['driver', 'company', 'factory', 'broker']) {
      await queryRunner.query(`CREATE SEQUENCE "account_code_${type}_seq"`);
    }

    await queryRunner.query(`
      CREATE FUNCTION "assign_account_code"() RETURNS trigger AS $$
      DECLARE
        role_name text;
      BEGIN
        SELECT "name" INTO role_name FROM "Role" WHERE "id" = NEW."roleId";
        UPDATE "User" SET "accountCode" = CASE role_name
            WHEN 'DRIVER' THEN '1' || lpad(nextval('account_code_driver_seq')::text, 4, '0')
            WHEN 'COMPANY' THEN '2' || lpad(nextval('account_code_company_seq')::text, 4, '0')
            WHEN 'FACTORY' THEN '3' || lpad(nextval('account_code_factory_seq')::text, 4, '0')
            WHEN 'BROKER' THEN '4' || lpad(nextval('account_code_broker_seq')::text, 4, '0')
          END
        WHERE "id" = NEW."userId" AND "accountCode" IS NULL AND role_name IN ('DRIVER', 'COMPANY', 'FACTORY', 'BROKER');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "UserRole_assign_account_code" AFTER INSERT ON "UserRole"
      FOR EACH ROW EXECUTE FUNCTION "assign_account_code"()
    `);

    // حساب‌های موجود، به ترتیب ثبت‌نام؛ هر حساب با اولین نقشش از این چهار نوع
    await queryRunner.query(`
      UPDATE "User" u
      SET "accountCode" = o."prefix" || lpad(o."n"::text, 4, '0')
      FROM (
        SELECT "userId", "prefix", row_number() OVER (PARTITION BY "prefix" ORDER BY "createdAt", "userId") AS "n"
        FROM (
          SELECT DISTINCT ON (ur."userId") ur."userId", us."createdAt",
            CASE r."name" WHEN 'DRIVER' THEN '1' WHEN 'COMPANY' THEN '2' WHEN 'FACTORY' THEN '3' ELSE '4' END AS "prefix"
          FROM "UserRole" ur
          JOIN "Role" r ON r."id" = ur."roleId"
          JOIN "User" us ON us."id" = ur."userId"
          WHERE r."name" IN ('DRIVER', 'COMPANY', 'FACTORY', 'BROKER')
          ORDER BY ur."userId", ur."createdAt"
        ) first_role
      ) o
      WHERE u."id" = o."userId"
    `);
    // حساب‌های تازه بعد از آخرین کد هر نوع
    for (const [type, prefix] of [['driver', '1'], ['company', '2'], ['factory', '3'], ['broker', '4']]) {
      const [{ count }] = await queryRunner.query(`SELECT count(*)::int AS count FROM "User" WHERE left("accountCode", 1) = $1`, [prefix]);
      if (count > 0) await queryRunner.query(`SELECT setval('account_code_${type}_seq', $1)`, [count]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "UserRole_assign_account_code" ON "UserRole"`);
    await queryRunner.query(`DROP FUNCTION "assign_account_code"()`);
    for (const type of ['driver', 'company', 'factory', 'broker']) {
      await queryRunner.query(`DROP SEQUENCE "account_code_${type}_seq"`);
    }
    await queryRunner.query(`DROP INDEX "IDX_User_accountCode"`);
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "accountCode"`);
  }
}
