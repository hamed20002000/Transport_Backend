import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateWhatsupuserMapping1788937269716 implements MigrationInterface {
    name = 'UpdateWhatsupuserMapping1788937269716'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" DROP CONSTRAINT "PK_fcbc0956949e5df9247ed05441b"`);
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" DROP COLUMN "userId"`);
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" ADD "userid" character varying(100) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" ADD CONSTRAINT "PK_848780ce0bdb2a30598080a9fbe" PRIMARY KEY ("userid")`);
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" ADD "username" character varying(100) NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" DROP COLUMN "username"`);
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" DROP CONSTRAINT "PK_848780ce0bdb2a30598080a9fbe"`);
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" DROP COLUMN "userid"`);
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" ADD "userId" character varying(100) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" ADD CONSTRAINT "PK_fcbc0956949e5df9247ed05441b" PRIMARY KEY ("userId")`);
    }

}
