import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateTelegramLinkAddTelegramLinkCode1788174625339 implements MigrationInterface {
    name = 'UpdateTelegramLinkAddTelegramLinkCode1788174625339'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "TelegramLinkCode" ("Id" uuid NOT NULL DEFAULT uuid_generate_v4(), "Code" character varying(6) NOT NULL, "Username" character varying NOT NULL, "Used" boolean NOT NULL DEFAULT false, "CreatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9f6b995e7d819e7427bbde2aeb2" PRIMARY KEY ("Id"))`);
        await queryRunner.query(`ALTER TABLE "TelegramLink" ADD "LastVerifiedAt" TIMESTAMP NOT NULL DEFAULT now()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TelegramLink" DROP COLUMN "LastVerifiedAt"`);
        await queryRunner.query(`DROP TABLE "TelegramLinkCode"`);
    }

}
