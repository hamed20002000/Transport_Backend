import { MigrationInterface, QueryRunner } from "typeorm";

export class AddToolDomainAndUpdateEmbeddingTool1760000000000
  implements MigrationInterface
{
  name = "AddToolDomainAndUpdateEmbeddingTool1760000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
    `);

    // Create ToolDomain table
    await queryRunner.query(`
      CREATE TABLE "ToolDomain" (
        "DomainName" text NOT NULL,
        "DisplayText" text NOT NULL,
        "Embedding" vector(1024),
        "SearchVector" tsvector
          GENERATED ALWAYS AS (
            to_tsvector('simple', "DisplayText")
          ) STORED,
        CONSTRAINT "ToolDomain_pkey"
          PRIMARY KEY ("DomainName")
      )
    `);

    // Add DomainName to existing EmbeddingTool table
    await queryRunner.query(`
      ALTER TABLE "EmbeddingTool"
      ADD COLUMN "DomainName" text
    `);

    // Create relation:
    // EmbeddingTool.DomainName
    //        ->
    // ToolDomain.DomainName
    await queryRunner.query(`
      ALTER TABLE "EmbeddingTool"
      ADD CONSTRAINT "FK_EmbeddingTool_ToolDomain"
      FOREIGN KEY ("DomainName")
      REFERENCES "ToolDomain"("DomainName")
      ON DELETE SET NULL
      ON UPDATE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove foreign key
    await queryRunner.query(`
      ALTER TABLE "EmbeddingTool"
      DROP CONSTRAINT "FK_EmbeddingTool_ToolDomain"
    `);

    // Remove DomainName from existing EmbeddingTool table
    await queryRunner.query(`
      ALTER TABLE "EmbeddingTool"
      DROP COLUMN "DomainName"
    `);

    // Remove ToolDomain table
    await queryRunner.query(`
      DROP TABLE "ToolDomain"
    `);
  }
}