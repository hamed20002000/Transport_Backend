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
import { DomainSeedResult, seedEmbeddingTools, seedToolDomains } from '../domainSeeding';
import { EMBEDDING_MODEL, EMBEDDING_URL } from '../domainRanking';

export const TOOL_DOCS_PATH = join(process.cwd(), 'src/application/services/agent/localFiles/tool_embedding_docs.json');
export const DOMAIN_DOCS_PATH = join(process.cwd(), 'src/application/services/agent/localFiles/domain_embedding_docs.json');


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

    /**
     * بدون ورودی: tool_embedding_docs.json منبع کامل است و جدول با آن جایگزین
     * می‌شود. با ورودی: فقط همان ابزارها دوباره نوشته می‌شوند.
     */
    async createVectorBased(embeddings?: EmbeddingToolType[]): Promise<{ written: string[] }> {
        const docs = embeddings ?? (JSON.parse(readFileSync(TOOL_DOCS_PATH, 'utf8')) as EmbeddingToolType[]);

        return seedEmbeddingTools(
            this.dataSource,
            docs.map((doc) => ({ tool_name: doc.tool_name, embedding_text: doc.embedding_text, domain_name: doc.domain_name })),
            async (text) => (await axios.post(EMBEDDING_URL, { model: EMBEDDING_MODEL, input: text })).data.embeddings[0],
            { replaceAll: !embeddings },
        );
    }

    /**
     * بدون ورودی: domain_embedding_docs.json منبع کامل است و domainهایی که در آن
     * نیستند پاک می‌شوند. با ورودی: فقط همان domainها اضافه یا به‌روز می‌شوند.
     */
    async createVectorBasedForDomainTool(embeddings?: EmbeddingDomainTool[]): Promise<DomainSeedResult> {
        const docs = embeddings ?? (JSON.parse(readFileSync(DOMAIN_DOCS_PATH, 'utf8')) as EmbeddingDomainTool[]);

        return seedToolDomains(
            this.dataSource,
            docs,
            async (text) => (await axios.post(EMBEDDING_URL, { model: EMBEDDING_MODEL, input: text })).data.embeddings[0],
            { removeMissing: !embeddings },
        );
    }
}