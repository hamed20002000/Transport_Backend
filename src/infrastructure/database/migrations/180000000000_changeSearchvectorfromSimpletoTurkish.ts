import { MigrationInterface, QueryRunner } from "typeorm";

export class SwitchSearchVectorToTurkish1700000000000 implements MigrationInterface {
    name = "SwitchSearchVectorToTurkish1700000000000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ============================================================
        // ToolDomain
        // ============================================================
        await queryRunner.query(`DROP INDEX IF EXISTS idx_tooldomain_searchvector;`);
        await queryRunner.query(`ALTER TABLE "ToolDomain" DROP COLUMN "SearchVector";`);
        await queryRunner.query(`
            ALTER TABLE "ToolDomain"
            ADD COLUMN "SearchVector" tsvector
            GENERATED ALWAYS AS (to_tsvector('turkish', "DisplayText")) STORED;
        `);
        await queryRunner.query(`
            CREATE INDEX idx_tooldomain_searchvector
            ON "ToolDomain" USING GIN ("SearchVector");
        `);

        // ============================================================
        // EmbeddingTool
        // ============================================================
        await queryRunner.query(`DROP INDEX IF EXISTS idx_embeddingtool_searchvector;`);
        await queryRunner.query(`ALTER TABLE "EmbeddingTool" DROP COLUMN IF EXISTS "SearchVector";`);
        await queryRunner.query(`
            ALTER TABLE "EmbeddingTool"
            ADD COLUMN "SearchVector" tsvector
            GENERATED ALWAYS AS (to_tsvector('turkish', "Document")) STORED;
        `);
        await queryRunner.query(`
            CREATE INDEX idx_embeddingtool_searchvector
            ON "EmbeddingTool" USING GIN ("SearchVector");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // برگردوندن به 'simple' -- دقیقاً همون مراحل، ولی معکوس

        // ToolDomain
        await queryRunner.query(`DROP INDEX IF EXISTS idx_tooldomain_searchvector;`);
        await queryRunner.query(`ALTER TABLE "ToolDomain" DROP COLUMN "SearchVector";`);
        await queryRunner.query(`
            ALTER TABLE "ToolDomain"
            ADD COLUMN "SearchVector" tsvector
            GENERATED ALWAYS AS (to_tsvector('simple', "DisplayText")) STORED;
        `);
        await queryRunner.query(`
            CREATE INDEX idx_tooldomain_searchvector
            ON "ToolDomain" USING GIN ("SearchVector");
        `);

        // EmbeddingTool
        await queryRunner.query(`DROP INDEX IF EXISTS idx_embeddingtool_searchvector;`);
        await queryRunner.query(`ALTER TABLE "EmbeddingTool" DROP COLUMN IF EXISTS "SearchVector";`);
        await queryRunner.query(`
            ALTER TABLE "EmbeddingTool"
            ADD COLUMN "SearchVector" tsvector
            GENERATED ALWAYS AS (to_tsvector('simple', "Document")) STORED;
        `);
        await queryRunner.query(`
            CREATE INDEX idx_embeddingtool_searchvector
            ON "EmbeddingTool" USING GIN ("SearchVector");
        `);
    }
}