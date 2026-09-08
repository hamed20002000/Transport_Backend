import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWhatsappEntities1788758893577 implements MigrationInterface {
    name = 'CreateWhatsappEntities1788758893577'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "WhatsappAuthCredential" ("sessionId" character varying(100) NOT NULL, "credsJson" text NOT NULL, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bdc343aa0f044366613f1b21a73" PRIMARY KEY ("sessionId"))`);
        await queryRunner.query(`CREATE TABLE "WhatsappUserMapping" ("userId" character varying(100) NOT NULL, "jid" character varying(100) NOT NULL, CONSTRAINT "PK_fcbc0956949e5df9247ed05441b" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`CREATE TABLE "WhatsappAuthKey" ("sessionId" character varying(100) NOT NULL, "keyType" character varying(100) NOT NULL, "keyId" character varying(200) NOT NULL, "valueJson" text NOT NULL, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_956242c2b9ce4f7a63c556e0bac" PRIMARY KEY ("sessionId", "keyType", "keyId"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "WhatsappAuthKey"`);
        await queryRunner.query(`DROP TABLE "WhatsappUserMapping"`);
        await queryRunner.query(`DROP TABLE "WhatsappAuthCredential"`);
    }

}
