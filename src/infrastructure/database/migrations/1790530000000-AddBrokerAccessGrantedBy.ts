import { MigrationInterface, QueryRunner } from 'typeorm';

/** دوره‌ی دسترسی واسط که ادمین بی‌خرید داده: چه کسی داد. */
export class AddBrokerAccessGrantedBy1790530000000 implements MigrationInterface {
  name = 'AddBrokerAccessGrantedBy1790530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "BrokerAccessPeriod" ADD COLUMN IF NOT EXISTS "grantedBy" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "BrokerAccessPeriod" DROP COLUMN IF EXISTS "grantedBy"`);
  }
}
