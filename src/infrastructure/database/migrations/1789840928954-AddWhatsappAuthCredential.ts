import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWhatsappAuthCredential1789840928954
  implements MigrationInterface
{
  name = 'AddWhatsappAuthCredential1789840928954';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // =========================================================
    // PostgreSQL extensions
    // =========================================================

    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS vector
    `);

    // =========================================================
    // Role
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "Role" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(100) NOT NULL,
        "title" character varying(200),
        "recordStatus" smallint NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "UQ_b852abd9e268a63287bc815aab6"
          UNIQUE ("name"),

        CONSTRAINT "PK_9309532197a7397548e341e5536"
          PRIMARY KEY ("id")
      )
    `);

    // =========================================================
    // UserRole
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "UserRole" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "roleId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "UQ_5835d63ff2d20a9c455d2a75d77"
          UNIQUE ("userId", "roleId"),

        CONSTRAINT "PK_83fd6b024a41173978f5b2b9b79"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_48ca98fafa3cd9a4c1e8caea1f"
      ON "UserRole" ("roleId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_c09e6f704c7cd9fe2bbc26a1a3"
      ON "UserRole" ("userId")
    `);

    // =========================================================
    // User
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "User" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "username" character varying(100) NOT NULL,
        "passwordHash" character varying(255) NOT NULL,
        "email" character varying(150),
        "mobile" character varying(20),
        "recordStatus" smallint NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "UQ_29a05908a0fa0728526d2833657"
          UNIQUE ("username"),

        CONSTRAINT "UQ_4a257d2c9837248d70640b3e36e"
          UNIQUE ("email"),

        CONSTRAINT "UQ_61b6f8232848228038b298548f1"
          UNIQUE ("mobile"),

        CONSTRAINT "PK_9862f679340fb2388436a5ab3e4"
          PRIMARY KEY ("id")
      )
    `);

    // =========================================================
    // CompanyUser
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "CompanyUser" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "transportCompanyId" uuid NOT NULL,
        "recordStatus" smallint NOT NULL DEFAULT '0',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "UQ_da24ee9e07d5a4dc9288029bf8e"
          UNIQUE ("userId", "transportCompanyId"),

        CONSTRAINT "PK_06a7e21b4e221f9721afdfa145e"
          PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_788975fcac3ff742d6d68c2c16"
      ON "CompanyUser" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_4791f9f0261570ef36e67884ec"
      ON "CompanyUser" ("transportCompanyId", "recordStatus")
    `);

    // =========================================================
    // WhatsApp
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "WhatsappUserMapping" (
        "userid" character varying(100) NOT NULL,
        "username" character varying(100) NOT NULL,
        "jid" character varying(100) NOT NULL,
        "CurrentSessionId" character varying(100),

        CONSTRAINT "UQ_a183e8da921dbe6589bdcdf8eab"
          UNIQUE ("jid"),

        CONSTRAINT "PK_848780ce0bdb2a30598080a9fbe"
          PRIMARY KEY ("userid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "WhatsappAuthKey" (
        "sessionId" character varying(100) NOT NULL,
        "keyType" character varying(100) NOT NULL,
        "keyId" character varying(200) NOT NULL,
        "valueJson" text NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_956242c2b9ce4f7a63c556e0bac"
          PRIMARY KEY ("sessionId", "keyType", "keyId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "WhatsappAuthCredential" (
        "sessionId" character varying(100) NOT NULL,
        "credsJson" text NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_bdc343aa0f044366613f1b21a73"
          PRIMARY KEY ("sessionId")
      )
    `);

    // =========================================================
    // ConversationSession
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "ConversationSession" (
        "Id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "Userid" character varying NOT NULL,
        "Title" character varying,
        "CreatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_4c9f995cd95ba9e2c98423172e4"
          PRIMARY KEY ("Id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_6d33ff7ed7946d4ae43843afa5"
      ON "ConversationSession" ("Userid")
    `);

    // =========================================================
    // PromptSubmission
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "PromptSubmission" (
        "Id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "SessionId" uuid NOT NULL,
        "RawPrompt" text NOT NULL,
        "SubmittedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_1908ed9cd1c0b4a11603cf25ad0"
          PRIMARY KEY ("Id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_3d39daf87177920dc6b3df5f35"
      ON "PromptSubmission" ("SessionId")
    `);

    // =========================================================
    // ToolExecution
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "ToolExecution" (
        "Id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "SubmissionId" uuid NOT NULL,
        "SubIntentText" text NOT NULL,
        "Operation" character varying NOT NULL,
        "Parameters" jsonb,
        "Result" jsonb,
        "Status" character varying NOT NULL,
        "ExecutedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_4e9038105c2456d1e6f02b51b07"
          PRIMARY KEY ("Id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_6eeb82dceb1300d998b17ee12b"
      ON "ToolExecution" ("SubmissionId")
    `);

    // =========================================================
    // ToolDomain
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "ToolDomain" (
        "DomainName" text NOT NULL,
        "DisplayText" text NOT NULL,

        "Embedding" vector(1024),

        "SearchVector" tsvector
          GENERATED ALWAYS AS (
            to_tsvector(
              'simple',
              COALESCE("DisplayText", '')
            )
          ) STORED,

        CONSTRAINT "PK_3d5954ca2b75b2a30e5fa4ca7cb"
          PRIMARY KEY ("DomainName")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "ToolDomain_pkey"
      ON "ToolDomain" ("DomainName")
    `);

    // =========================================================
    // EmbeddingTool
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "EmbeddingTool" (
        "Id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ToolName" character varying NOT NULL,
        "Document" text NOT NULL,

        "Embedding" vector(1024),

        "DomainName" text,

        CONSTRAINT "PK_ec1a28de59ee5ee628cbb73cb5a"
          PRIMARY KEY ("Id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "Embedding_pkey"
      ON "EmbeddingTool" ("Id")
    `);

    // =========================================================
    // Telegram
    // =========================================================

    await queryRunner.query(`
      CREATE TABLE "TelegramLinkCode" (
        "Id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "Code" character varying(6) NOT NULL,
        "Userid" character varying NOT NULL,
        "Used" boolean NOT NULL DEFAULT false,
        "CreatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_9f6b995e7d819e7427bbde2aeb2"
          PRIMARY KEY ("Id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "TelegramLink" (
        "Id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "Userid" character varying NOT NULL,
        "ChatId" bigint NOT NULL,
        "LastVerifiedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "CurrentSessionId" character varying,

        CONSTRAINT "PK_afff5372064277b96257bba2174"
          PRIMARY KEY ("Id")
      )
    `);

    // =========================================================
    // Driver -> User
    // =========================================================

    await queryRunner.query(`
      ALTER TABLE "Driver"
      ADD CONSTRAINT "UQ_83a436cab0a8248ea6585d8d646"
      UNIQUE ("userId")
    `);

    // =========================================================
    // Foreign Keys
    // =========================================================

    await queryRunner.query(`
      ALTER TABLE "UserRole"
      ADD CONSTRAINT "FK_c09e6f704c7cd9fe2bbc26a1a38"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "UserRole"
      ADD CONSTRAINT "FK_48ca98fafa3cd9a4c1e8caea1fe"
      FOREIGN KEY ("roleId")
      REFERENCES "Role"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "CompanyUser"
      ADD CONSTRAINT "FK_788975fcac3ff742d6d68c2c160"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "CompanyUser"
      ADD CONSTRAINT "FK_a912cda8cf956e551de3b4ce475"
      FOREIGN KEY ("transportCompanyId")
      REFERENCES "TransportCompany"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "Driver"
      ADD CONSTRAINT "FK_83a436cab0a8248ea6585d8d646"
      FOREIGN KEY ("userId")
      REFERENCES "User"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "PromptSubmission"
      ADD CONSTRAINT "FK_3d39daf87177920dc6b3df5f355"
      FOREIGN KEY ("SessionId")
      REFERENCES "ConversationSession"("Id")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "ToolExecution"
      ADD CONSTRAINT "FK_6eeb82dceb1300d998b17ee12b1"
      FOREIGN KEY ("SubmissionId")
      REFERENCES "PromptSubmission"("Id")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "EmbeddingTool"
      ADD CONSTRAINT "FK_d45dc374a477a560c9dd3766b86"
      FOREIGN KEY ("DomainName")
      REFERENCES "ToolDomain"("DomainName")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // =========================================================
    // Foreign Keys
    // =========================================================

    await queryRunner.query(`
      ALTER TABLE "EmbeddingTool"
      DROP CONSTRAINT "FK_d45dc374a477a560c9dd3766b86"
    `);

    await queryRunner.query(`
      ALTER TABLE "ToolExecution"
      DROP CONSTRAINT "FK_6eeb82dceb1300d998b17ee12b1"
    `);

    await queryRunner.query(`
      ALTER TABLE "PromptSubmission"
      DROP CONSTRAINT "FK_3d39daf87177920dc6b3df5f355"
    `);

    await queryRunner.query(`
      ALTER TABLE "Driver"
      DROP CONSTRAINT "FK_83a436cab0a8248ea6585d8d646"
    `);

    await queryRunner.query(`
      ALTER TABLE "CompanyUser"
      DROP CONSTRAINT "FK_a912cda8cf956e551de3b4ce475"
    `);

    await queryRunner.query(`
      ALTER TABLE "CompanyUser"
      DROP CONSTRAINT "FK_788975fcac3ff742d6d68c2c160"
    `);

    await queryRunner.query(`
      ALTER TABLE "UserRole"
      DROP CONSTRAINT "FK_48ca98fafa3cd9a4c1e8caea1fe"
    `);

    await queryRunner.query(`
      ALTER TABLE "UserRole"
      DROP CONSTRAINT "FK_c09e6f704c7cd9fe2bbc26a1a38"
    `);

    await queryRunner.query(`
      ALTER TABLE "Driver"
      DROP CONSTRAINT "UQ_83a436cab0a8248ea6585d8d646"
    `);

    // =========================================================
    // Telegram
    // =========================================================

    await queryRunner.query(`DROP TABLE "TelegramLink"`);
    await queryRunner.query(`DROP TABLE "TelegramLinkCode"`);

    // =========================================================
    // EmbeddingTool
    // =========================================================

    await queryRunner.query(`
      DROP INDEX "public"."Embedding_pkey"
    `);

    await queryRunner.query(`
      DROP TABLE "EmbeddingTool"
    `);

    // =========================================================
    // ToolDomain
    // =========================================================

    await queryRunner.query(`
      DROP INDEX "public"."ToolDomain_pkey"
    `);

    await queryRunner.query(`
      DROP TABLE "ToolDomain"
    `);

    // =========================================================
    // ToolExecution
    // =========================================================

    await queryRunner.query(`
      DROP INDEX "public"."IDX_6eeb82dceb1300d998b17ee12b"
    `);

    await queryRunner.query(`
      DROP TABLE "ToolExecution"
    `);

    // =========================================================
    // PromptSubmission
    // =========================================================

    await queryRunner.query(`
      DROP INDEX "public"."IDX_3d39daf87177920dc6b3df5f35"
    `);

    await queryRunner.query(`
      DROP TABLE "PromptSubmission"
    `);

    // =========================================================
    // ConversationSession
    // =========================================================

    await queryRunner.query(`
      DROP INDEX "public"."IDX_6d33ff7ed7946d4ae43843afa5"
    `);

    await queryRunner.query(`
      DROP TABLE "ConversationSession"
    `);

    // =========================================================
    // WhatsApp
    // =========================================================

    await queryRunner.query(`
      DROP TABLE "WhatsappAuthCredential"
    `);

    await queryRunner.query(`
      DROP TABLE "WhatsappAuthKey"
    `);

    await queryRunner.query(`
      DROP TABLE "WhatsappUserMapping"
    `);

    // =========================================================
    // CompanyUser
    // =========================================================

    await queryRunner.query(`
      DROP INDEX "public"."IDX_4791f9f0261570ef36e67884ec"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."IDX_788975fcac3ff742d6d68c2c16"
    `);

    await queryRunner.query(`
      DROP TABLE "CompanyUser"
    `);

    // =========================================================
    // User
    // =========================================================

    await queryRunner.query(`
      DROP TABLE "User"
    `);

    // =========================================================
    // UserRole
    // =========================================================

    await queryRunner.query(`
      DROP INDEX "public"."IDX_c09e6f704c7cd9fe2bbc26a1a3"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."IDX_48ca98fafa3cd9a4c1e8caea1f"
    `);

    await queryRunner.query(`
      DROP TABLE "UserRole"
    `);

    // =========================================================
    // Role
    // =========================================================

    await queryRunner.query(`
      DROP TABLE "Role"
    `);

    /*
     * عمداً:
     *
     * DROP EXTENSION vector
     *
     * انجام نمی‌دهیم.
     *
     * چون ممکن است در آینده جداول دیگری هم از pgvector
     * استفاده کنند.
     */
  }
}