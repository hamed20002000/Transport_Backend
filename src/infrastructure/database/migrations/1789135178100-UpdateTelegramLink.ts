import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateTelegramLink1789135178100 implements MigrationInterface {
    name = 'UpdateTelegramLink1789135178100'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelegramLink" ADD "CurrentSessionId" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelegramLink" DROP COLUMN "CurrentSessionId"`);
    }

}
