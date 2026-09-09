import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateWhatsupuserMapping21788940072144 implements MigrationInterface {
    name = 'UpdateWhatsupuserMapping21788940072144'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" ADD CONSTRAINT "UQ_a183e8da921dbe6589bdcdf8eab" UNIQUE ("jid")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "WhatsappUserMapping" DROP CONSTRAINT "UQ_a183e8da921dbe6589bdcdf8eab"`);
    }

}
