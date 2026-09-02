import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateTelegramLink1788238293484 implements MigrationInterface {
    name = 'UpdateTelegramLink1788238293484'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelegramLink" RENAME COLUMN "Username" TO "Userid"`);
        await queryRunner.query(`ALTER TABLE "TelegramLinkCode" RENAME COLUMN "Username" TO "Userid"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelegramLinkCode" RENAME COLUMN "Userid" TO "Username"`);
        await queryRunner.query(`ALTER TABLE "TelegramLink" RENAME COLUMN "Userid" TO "Username"`);
    }

}
