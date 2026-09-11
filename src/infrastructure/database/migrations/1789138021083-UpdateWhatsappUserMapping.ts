import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateWhatsappUserMapping1789138021083 implements MigrationInterface {
    name = 'UpdateWhatsappUserMapping1789138021083'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" ADD "CurrentSessionId" character varying(100)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" DROP COLUMN "CurrentSessionId"`);
    }

}
