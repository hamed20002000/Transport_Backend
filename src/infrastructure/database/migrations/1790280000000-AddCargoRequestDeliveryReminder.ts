import { MigrationInterface, QueryRunner } from 'typeorm';

/** یادآوری «تحویل داده شد؟» برای سفرهای فعالی که تحویلشان ثبت نشده. */
export class AddCargoRequestDeliveryReminder1790280000000 implements MigrationInterface {
  name = 'AddCargoRequestDeliveryReminder1790280000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" ADD COLUMN "deliveryRemindedAt" TIMESTAMP NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "CargoRequest" DROP COLUMN "deliveryRemindedAt"`);
  }
}
