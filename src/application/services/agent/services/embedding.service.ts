import { Injectable } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChatRequest, Tool } from 'src/agent/types';
import axios from "axios";
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import tools from 'src/application/services/agent/localFiles/tools.json';
import { ToolRegister } from '../toolRegister';
import { EmbeddingDomainTool, EmbeddingToolType } from '../types';


@Injectable()
export class EmbeddingService {
    constructor(
        private readonly toolRegister: ToolRegister,
        @InjectDataSource() private readonly dataSource: DataSource
    ) {

    }


    async converToolsToembeddingDocument(): Promise<void> {

        const toolList = tools.tools;
        const embeddingList: {
            tool_name: string;
            document: string;
        }[] = [];
        for (const tool of toolList) {

            const prompt = `Convert this tool definition into an embedding document.
                    The document should contain:
                    - Tool name
                    - Description
                    - When to use
                    - Business keywords
                    - Examples
                    Do not add unsupported functionality.
                    Tool Definition: ${JSON.stringify(tool)}`;

            const ollamareq: ChatRequest = {
                model: "qwen3:8b",
                messages: [
                    {
                        role: 'system',
                        content: "you are a tool embedding document generator. You will receive a tool definition and you need to convert it into an embedding document. The document should contain the following fields: Tool name, Description, When to use, Business keywords, Examples. Do not add unsupported functionality."
                    },
                    {
                        role: "user",
                        content: prompt
                    }],
                stream: false,

            }

            const resp = await axios.post(
                "http://localhost:11434/api/chat",
                JSON.stringify({
                    ...ollamareq
                }),

                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            );

            embeddingList.push({
                tool_name: tool.name,
                document: resp.data.message.content
            });
        }

        const markdownContent = embeddingList
            .map(item => {
                return `
                                # Tool Name
                                ${item.tool_name}

                                ${item.document}

                                ---

                                `;
            })
            .join("\n");

        writeFileSync(
            "src/application/services/agent/localFiles/tool_embedding_docs.md",
            markdownContent
        );
    }

    async createVectorBased(embeddings?: EmbeddingToolType[]): Promise<void> {

        let toolEmbeddingDocs = null

        if (!embeddings) {
                toolEmbeddingDocs = JSON.parse(readFileSync(
                join(process.cwd(), 'src/application/services/agent/localFiles/tool_embedding_docs.json'),
                'utf8'
            )) as unknown as {
                tool_name: string;
                embedding_text: string;
                domain_name: string
            }[];


        }
        else {
            toolEmbeddingDocs = embeddings

        }



        for (const doc of toolEmbeddingDocs) {

            const document = `
                ${doc.embedding_text}
                `;
            ;
            const resp = await axios.post(
                "http://localhost:11434/api/embed", {
                model: "bge-m3:latest",
                input: document
            }
            )

            await this.dataSource.query(
                `
                INSERT INTO "EmbeddingTool"
                    ("ToolName", "Document", "Embedding","DomainName")
                VALUES
                    ($1, $2, $3,$4)
                `,
                [
                    doc.tool_name,
                    doc.embedding_text,
                    `[${resp.data.embeddings[0].join(",")}]`,
                    doc.domain_name
                ]
            );
        }

    }

    async createVectorBasedForDomainTool(embeddings?: EmbeddingDomainTool[]): Promise<void> {
        let toolEmbeddingDocs =null;

        if (!embeddings) {
            toolEmbeddingDocs = JSON.parse(readFileSync(
                join(process.cwd(), 'src/application/services/agent/localFiles/domain_embedding_docs.json'),
                'utf8'
            )) as unknown as {
                domain_name: string;
                embedding_text: string
            }[]
        }
        else{
            toolEmbeddingDocs=embeddings
        }



        for (const doc of toolEmbeddingDocs) {

            const document = `
                ${doc.embedding_text}
                `;
            ;
            const resp = await axios.post(
                "http://localhost:11434/api/embed", {
                model: "bge-m3:latest",
                input: document
            }
            )

            await this.dataSource.query(
                `
                INSERT INTO "ToolDomain"
                    ("DomainName", "DisplayText", "Embedding")
                VALUES
                    ($1, $2, $3)
                `,
                [
                    doc.domain_name,
                    doc.embedding_text,
                    `[${resp.data.embeddings[0].join(",")}]`
                ]
            );
        }

    }


}