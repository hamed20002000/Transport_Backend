import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHistoryHistoryPrompt1787606941068 implements MigrationInterface {
    name = 'AddHistoryHistoryPrompt1787606941068'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "ConversationSession" ("Id" uuid NOT NULL DEFAULT uuid_generate_v4(), "Username" character varying NOT NULL, "Title" character varying, "CreatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4c9f995cd95ba9e2c98423172e4" PRIMARY KEY ("Id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3463a299e128130db3a3056e17" ON "ConversationSession" ("Username") `);
        await queryRunner.query(`CREATE TABLE "ToolExecution" ("Id" uuid NOT NULL DEFAULT uuid_generate_v4(), "SubmissionId" uuid NOT NULL, "SubIntentText" text NOT NULL, "Operation" character varying NOT NULL, "Parameters" jsonb, "Result" jsonb, "Status" character varying NOT NULL, "ExecutedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4e9038105c2456d1e6f02b51b07" PRIMARY KEY ("Id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6eeb82dceb1300d998b17ee12b" ON "ToolExecution" ("SubmissionId") `);
        await queryRunner.query(`CREATE TABLE "PromptSubmission" ("Id" uuid NOT NULL DEFAULT uuid_generate_v4(), "SessionId" uuid NOT NULL, "RawPrompt" text NOT NULL, "SubmittedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1908ed9cd1c0b4a11603cf25ad0" PRIMARY KEY ("Id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3d39daf87177920dc6b3df5f35" ON "PromptSubmission" ("SessionId") `);
        await queryRunner.query(`ALTER TABLE "ToolExecution" ADD CONSTRAINT "FK_6eeb82dceb1300d998b17ee12b1" FOREIGN KEY ("SubmissionId") REFERENCES "PromptSubmission"("Id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "PromptSubmission" ADD CONSTRAINT "FK_3d39daf87177920dc6b3df5f355" FOREIGN KEY ("SessionId") REFERENCES "ConversationSession"("Id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "PromptSubmission" DROP CONSTRAINT "FK_3d39daf87177920dc6b3df5f355"`);
        await queryRunner.query(`ALTER TABLE "ToolExecution" DROP CONSTRAINT "FK_6eeb82dceb1300d998b17ee12b1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3d39daf87177920dc6b3df5f35"`);
        await queryRunner.query(`DROP TABLE "PromptSubmission"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6eeb82dceb1300d998b17ee12b"`);
        await queryRunner.query(`DROP TABLE "ToolExecution"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3463a299e128130db3a3056e17"`);
        await queryRunner.query(`DROP TABLE "ConversationSession"`);
    }

}
