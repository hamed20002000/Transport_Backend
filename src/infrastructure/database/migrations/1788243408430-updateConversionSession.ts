import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateConversionSession1788243408430 implements MigrationInterface {
    name = 'UpdateConversionSession1788243408430'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_3463a299e128130db3a3056e17"`);
        await queryRunner.query(`ALTER TABLE "ConversationSession" RENAME COLUMN "Username" TO "Userid"`);
        await queryRunner.query(`CREATE INDEX "IDX_6d33ff7ed7946d4ae43843afa5" ON "ConversationSession" ("Userid") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_6d33ff7ed7946d4ae43843afa5"`);
        await queryRunner.query(`ALTER TABLE "ConversationSession" RENAME COLUMN "Userid" TO "Username"`);
        await queryRunner.query(`CREATE INDEX "IDX_3463a299e128130db3a3056e17" ON "ConversationSession" ("Username") `);
    }

}
