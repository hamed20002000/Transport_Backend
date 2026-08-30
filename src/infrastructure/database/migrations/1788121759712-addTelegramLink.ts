import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTelegramLink1788121759712 implements MigrationInterface {
    name = 'AddTelegramLink1788121759712'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "TelegramLink" ("Id" uuid NOT NULL DEFAULT uuid_generate_v4(), "Username" character varying NOT NULL, "ChatId" bigint NOT NULL, CONSTRAINT "PK_afff5372064277b96257bba2174" PRIMARY KEY ("Id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "TelegramLink"`);
    }

}
