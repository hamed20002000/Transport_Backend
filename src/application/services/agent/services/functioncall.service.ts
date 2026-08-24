import { Injectable } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChatRequest, Tool } from 'src/agent/types';
import axios from "axios";
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import tools from 'src/application/services/agent/localFiles/tools.json';
import { ToolRegister } from '../toolRegister';
import { AgentGateway } from '../agent.gateway';
import tables from 'src/agent/tables.json';
import schema from 'src/application/services/agent/schema.json';
import { CondinateService } from './condinate.service';
import { AgentToolsService } from './agentTools.service';
import { ContextManager } from '../contextManager';
import socketMapping from '../localFiles/socketMapping.json'
import { CancellationService } from './cancellation.service';



@Injectable()
export class FunctionCallService {
    constructor(
        private readonly toolRegister: ToolRegister,
        private readonly agentGateway: AgentGateway,
        private readonly condinate: CondinateService,
        private readonly agentToolsService: AgentToolsService,
        private readonly history: ContextManager,
        private readonly cancellation: CancellationService,

        @InjectDataSource() private readonly dataSource: DataSource
    ) {
          
    }

    async extractSchema(prompt: string): Promise<string> {



        const systemRules = `You are a database table selection agent.

Your ONLY task is to select required database tables.

Rules:
- Use ONLY tables from the provided catalog.
- Never explain your answer.
- Never generate SQL.
- Never show reasoning.
- Return ONLY JSON.
- The response must start with { and end with }.

Output format:

{
  "tables": ["TableName"]
}`


        prompt = `
Table catalog:

${JSON.stringify(tables, null, 2)}

Request:
${prompt}`;



        const ollamareq: ChatRequest = {
            model: "qwen3:8b",
            messages: [
                {
                    role: 'system',
                    content: systemRules
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
                ...ollamareq, format: {
                    type: "object",
                    properties: {
                        tables: {
                            type: "array",
                            items: {
                                type: "string"
                            }
                        }
                    },
                    required: ["tables"]
                }
            }),

            {
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );
        const tablesResponse = JSON.parse(resp.data.message.content)?.tables || [];
        const selectedTables = [];
        for (const tableName of tablesResponse) {
            const table = schema.tables.find(t => t.name === tableName);
            if (table) {
                selectedTables.push(table);
            }
        }

        return JSON.stringify(selectedTables, null, 2);
    }

    async FunctionCallingOrSqlSelection(prompt: string): Promise<string> {

        const systemContent = readFileSync(
            join(process.cwd(), 'src/application/services/agent/prompts/selector.prompt'),
            'utf8'
        );
        const ollamareq: ChatRequest = {
            model: "qwen3:8b",
            messages: [
                {
                    role: 'system',
                    content: systemContent
                },
                {
                    role: "user",
                    content: prompt
                }],
            stream: false,
            options: {
                temperature: 0,
                top_p: 0.9,
                repeat_penalty: 1.1
            }

        }


        const resp = await axios.post(
            "http://localhost:11434/api/chat",
            JSON.stringify({
                ...ollamareq, format: {
                    type: "object",
                    properties: {
                        decision: {
                            type: "string",
                            enum: [
                                "functionCalling",
                                "sql"
                            ]
                        }
                    },
                    required: [
                        "decision"
                    ]
                }
            }),

            {
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );

        return JSON.parse(resp.data.message.content).decision;
    }

    async segmentPromptIntoSubIntents(prompt: string): Promise<string[]> {
        const systemPrompt = `
You are a text segmentation assistant.

Your task: if the user's message (in Turkish) contains multiple independent
operation requests, split them into separate sentences. Each resulting
sentence must be self-contained and represent one independent operation
request.

Rules:
- If the message contains only ONE operation request, return the original
  sentence UNCHANGED and COMPLETE as a single-element list -- never trim,
  shorten, or extract only part of it.
- Quoted text (e.g. "Kategori 34") is a PARAMETER VALUE belonging to the
  operation, never an operation by itself. Never return a quoted value
  alone as its own segment -- it must always stay attached to the full
  sentence describing what to do with it.
- Preserve the original wording in each segment as much as possible
  (split, don't rewrite, paraphrase, or truncate).
- Use Turkish connective words as split points: "ve" (and), "ile" (with),
  "sonra" (then), "ayrıca" (also), and commas separating distinct clauses.
  Do NOT split on "ile" when it connects a quoted name to the verb of the
  SAME operation (e.g. "... adıyla ... kaydedin" is one operation, not two).
- Keep parameters (names, values) attached to the segment they belong to.
- CRITICAL -- shared trailing verb: if multiple objects share a single
  verb that appears only once, at the end of the sentence (e.g. "X ve
  Y'yi kaydedin" = "register X and Y"), each resulting segment MUST include
  its own copy of that verb. Never leave an earlier segment without a verb
  just because the verb appeared later in the original sentence -- every
  segment must be a grammatically complete, standalone operation request.
- The input and output text must remain in Turkish -- you are only
  splitting the sentence structure, not translating, summarizing, or
  extracting keywords.

Examples:

Input: "Kategori 34" adıyla bir kategori kaydedin.
Output: { "segments": ["\\"Kategori 34\\" adıyla bir kategori kaydedin."] }
(One operation. The quoted name is a parameter, not a separate segment.)

Input: bir kullanıcı oluştur ve bir rol ekle
Output: { "segments": ["bir kullanıcı oluştur", "bir rol ekle"] }
(Two independent operations, split at "ve".)

Input: AAA ürününü sil
Output: { "segments": ["AAA ürününü sil"] }
(One operation, nothing to split.)

Input: Kategori K 123 ve kategori K 56'yı kaydedin
Output: { "segments": ["Kategori K 123'ü kaydedin", "kategori K 56'yı kaydedin"] }
(Two operations sharing one trailing verb "kaydedin" -- the verb is
duplicated into the first segment so it stays grammatically complete,
instead of leaving "Kategori K 123" alone without any verb.)

Return JSON only, nothing else:
{ "segments": ["...", "..."] }
`;
        const ollamareq: ChatRequest = {
            model: "qwen3:8b",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt },
            ],
            stream: false,
        };
        const resp = await axios.post(
            "http://localhost:11434/api/chat",
            JSON.stringify({
                ...ollamareq,
                format: {
                    type: "object",
                    properties: {
                        segments: {
                            type: "array",
                            items: { type: "string" },
                        },
                    },
                    required: ["segments"],
                },
            }),
            { headers: { "Content-Type": "application/json" } }
        );
        const result = JSON.parse(resp.data.message.content);

        const segments: string[] = result.segments && result.segments.length > 0 ? result.segments : [prompt];

        // لایه‌ی دفاعی ۱: پوشش کلی طول متن (برای مواردی مثل "Kategori 34"
        // که کل جمله گم می‌شد)
        const totalSegmentLength = segments.reduce((sum, s) => sum + s.length, 0);
        const coverageRatio = totalSegmentLength / prompt.length;

        if (coverageRatio < 0.7) {
            console.warn(
                `Segmentation coverage too low (${(coverageRatio * 100).toFixed(0)}%) for prompt: "${prompt}". Falling back to original prompt.`
            );
            return [prompt];
        }

        // لایه‌ی دفاعی ۲: بررسی وجود فعل امری در هر segment -- برای مواردی
        // مثل "X ve Y'yi kaydedin" که ممکنه یک segment بدون فعل بمونه.
        // این یک لیست کامل از همه‌ی فعل‌های ممکن نیست (که مقیاس‌پذیر نباشه)،
        // فقط یک الگوی خیلی کلی: هر segment باید حداقل ۲ کلمه داشته باشه
        // و شبیه یک جمله‌ی کامل به‌نظر برسه، نه فقط یک اسم/عبارت تنها.
        const suspiciouslyIncompleteSegment = segments.some((s) => s.trim().split(/\s+/).length < 2);

        if (suspiciouslyIncompleteSegment) {
            console.warn(
                `Segmentation produced a suspiciously short/incomplete segment for prompt: "${prompt}". Falling back to original prompt.`
            );
            return [prompt];
        }

        return segments;
    }

    async RunFunctionCalling(prompt: string, req: any, files: string[]): Promise<void> {
        const userId = req.user.userid;
        const username = req.user.username;

        // شروع یک اجرای جدید و قابل‌لغو برای این کاربر
        const controller = this.cancellation.start(userId);


        try {

            this.agentGateway.sendCurrentTool(req.user.userid, {
                currentOp: "Hazırlıkların yapılması"
            })
            const segmentsPrompts = await this.segmentPromptIntoSubIntents(prompt);
            var currentsegmentIndex = 0;
            for (const subIntent of segmentsPrompts) {

                if (controller.signal.aborted) {
                    this.agentGateway.sendToolResult(userId, {
                        result: "cancelled",
                        message: "İşlem kullanıcı tarafından durduruldu.",
                        continuePrompt: undefined,
                        toolName: undefined,
                        lastsegment: true,
                        list: []
                    });
                    break;
                }


                this.agentGateway.sendCurrentTool(req.user.userid, {
                    currentOp: `(${subIntent})'nin emrini yerine getirmeye hazırlanıyoruz.`
                })

                currentsegmentIndex++;
                const condinateToolsName = await this.condinate.getCondinateToolsForRunPrompt(subIntent, this.history.getPreviousTool(req.user.username) as string)
                const selectedToolName = await this.agentToolsService.extractSelectedTool(subIntent, condinateToolsName, this.history.getHistory(0, req.user.username) as string);
                try {

                    this.agentGateway.sendCurrentTool(req.user.userid, {
                        currentOp: socketMapping[selectedToolName]
                    })

                    const selectedTool = await this.agentToolsService.extractTools(subIntent, selectedToolName, this.history.getHistory(0, req.user.username) as string);
                    const toolResult = await this.agentToolsService.executeTool(selectedTool.functionName, { ...selectedTool.parameters, files: files }, req);
                    this.agentGateway.sendToolResult(req.user.userid, {
                        result: "success",
                        message: socketMapping[`${selectedToolName}_end`],
                        continuePrompt: toolResult.continuePrompt,
                        toolName: toolResult.toolName,
                        lastsegment: currentsegmentIndex == segmentsPrompts.length,
                        list: []
                    })
                }
                catch (error: any) {
                    this.agentGateway.sendToolResult(req.user.userid, {
                        result: "error",
                        message: error?.message || "İşlem gerçekleştirilirken hata oluştu.",
                        continuePrompt: this.history.frequencyError(req.user.username) ? "Komut istemi ardı ardına hatalar veriyorsa, komut istemini değiştirin." : undefined,
                        toolName: undefined,
                        lastsegment: true,
                        list: []
                    })

                    break;


                }

            }
        }
        catch (error) {
            this.agentGateway.sendToolResult(req.user.userid, {
                result: "error",
                message: "Kritik hata, lütfen operatörle iletişime geçin.",
                continuePrompt: undefined,
                toolName: undefined,
                lastsegment: true,

                list: []
            })
        }
        finally {
            // چه موفق، چه خطا، چه cancel شده باشه -- همیشه باید پاک‌سازی بشه
            this.cancellation.finish(userId);
        }
    }


}