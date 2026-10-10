import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * سپردن بار به راننده هنگام «برداشته شد»: مهلت تأیید راننده روی CargoRequest
 * (وضعیت‌های OFFERED/DECLINED/EXPIRED در همان ستون varchar) و عکس چهره‌ی راننده.
 */
export class AddCargoOffer1790200000000 implements MigrationInterface {
  name = 'AddCargoOffer1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD "offerExpiresAt" TIMESTAMP`);
    // پیدا کردن پیشنهادهای منقضی‌شده (هر دقیقه)
    await queryRunner.query(
      `CREATE INDEX "IDX_CargoRequest_offer_expiry" ON "CargoRequest" ("offerExpiresAt") WHERE "status" = 'OFFERED'`,
    );
    await queryRunner.query(`ALTER TABLE "DriverProfile" ADD "facePhoto" character varying(60)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "DriverProfile" DROP COLUMN "facePhoto"`);
    await queryRunner.query(`DROP INDEX "IDX_CargoRequest_offer_expiry"`);
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN "offerExpiresAt"`);
  }
}
