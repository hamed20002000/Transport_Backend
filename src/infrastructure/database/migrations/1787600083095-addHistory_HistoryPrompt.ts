import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHistoryHistoryPrompt1787600083095 implements MigrationInterface {
    name = 'AddHistoryHistoryPrompt1787600083095'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "HistoryPrompt" ("id" BIGSERIAL NOT NULL, "prompt" character varying(200), "HistoryId" bigint, CONSTRAINT "PK_9e4d8a88de43df92d6a1cd867dd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "HistoryPrompt_pkey" ON "HistoryPrompt" ("id") `);
        await queryRunner.query(`CREATE TABLE "History" ("id" BIGSERIAL NOT NULL, "userId" bigint NOT NULL, "title" character varying(200), "CreateAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_ba2fff4418f12dffa3d21157008" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "History_pkey" ON "History" ("id") `);
        await queryRunner.query(`CREATE TABLE "HistoryPrompt_closure" ("id_ancestor" bigint NOT NULL, "id_descendant" bigint NOT NULL, CONSTRAINT "PK_42661eb26d030667f46d4558de0" PRIMARY KEY ("id_ancestor", "id_descendant"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f6ec586ee435ce386e625e298b" ON "HistoryPrompt_closure" ("id_ancestor") `);
        await queryRunner.query(`CREATE INDEX "IDX_b89210b81322ffe600b8bc9df3" ON "HistoryPrompt_closure" ("id_descendant") `);
        await queryRunner.query(`CREATE TABLE "History_closure" ("id_ancestor" bigint NOT NULL, "id_descendant" bigint NOT NULL, CONSTRAINT "PK_ec5b78eb8a8cde06c377a738800" PRIMARY KEY ("id_ancestor", "id_descendant"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f791fd456332cd99413bdc669d" ON "History_closure" ("id_ancestor") `);
        await queryRunner.query(`CREATE INDEX "IDX_29b91af6d670d52dc970d776e9" ON "History_closure" ("id_descendant") `);
        await queryRunner.query(`ALTER TABLE "HistoryPrompt" ADD CONSTRAINT "FK_056d0589d78aa1a2d85808d53e7" FOREIGN KEY ("HistoryId") REFERENCES "History"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "HistoryPrompt_closure" ADD CONSTRAINT "FK_f6ec586ee435ce386e625e298b5" FOREIGN KEY ("id_ancestor") REFERENCES "HistoryPrompt"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "HistoryPrompt_closure" ADD CONSTRAINT "FK_b89210b81322ffe600b8bc9df3f" FOREIGN KEY ("id_descendant") REFERENCES "HistoryPrompt"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "History_closure" ADD CONSTRAINT "FK_f791fd456332cd99413bdc669da" FOREIGN KEY ("id_ancestor") REFERENCES "History"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "History_closure" ADD CONSTRAINT "FK_29b91af6d670d52dc970d776e9e" FOREIGN KEY ("id_descendant") REFERENCES "History"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "History_closure" DROP CONSTRAINT "FK_29b91af6d670d52dc970d776e9e"`);
        await queryRunner.query(`ALTER TABLE "History_closure" DROP CONSTRAINT "FK_f791fd456332cd99413bdc669da"`);
        await queryRunner.query(`ALTER TABLE "HistoryPrompt_closure" DROP CONSTRAINT "FK_b89210b81322ffe600b8bc9df3f"`);
        await queryRunner.query(`ALTER TABLE "HistoryPrompt_closure" DROP CONSTRAINT "FK_f6ec586ee435ce386e625e298b5"`);
        await queryRunner.query(`ALTER TABLE "HistoryPrompt" DROP CONSTRAINT "FK_056d0589d78aa1a2d85808d53e7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_29b91af6d670d52dc970d776e9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f791fd456332cd99413bdc669d"`);
        await queryRunner.query(`DROP TABLE "History_closure"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b89210b81322ffe600b8bc9df3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f6ec586ee435ce386e625e298b"`);
        await queryRunner.query(`DROP TABLE "HistoryPrompt_closure"`);
        await queryRunner.query(`DROP INDEX "public"."History_pkey"`);
        await queryRunner.query(`DROP TABLE "History"`);
        await queryRunner.query(`DROP INDEX "public"."HistoryPrompt_pkey"`);
        await queryRunner.query(`DROP TABLE "HistoryPrompt"`);
    }

}
