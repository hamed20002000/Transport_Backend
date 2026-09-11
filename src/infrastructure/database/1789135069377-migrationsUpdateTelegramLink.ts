import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationsUpdateTelegramLink1789135069377 implements MigrationInterface {
    name = 'MigrationsUpdateTelegramLink1789135069377'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelegramLink" ADD "CurrentSessionId" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelegramLink" DROP COLUMN "CurrentSessionId"`);
    }

}
