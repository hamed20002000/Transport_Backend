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
import { ConversationSession } from '../entities/ConversationSession';
import { PromptSubmission } from '../entities/PromptSubmission';
import { ToolExecution } from '../entities/ToolExecution';
import { ContextInfo, PendingGeneratorType } from '../types';
import { PendingConfirmationService } from './PendingConfirmationService';
import { In } from 'typeorm';



@Injectable()
export class FunctionCallService {
    constructor(
        private readonly toolRegister: ToolRegister,
        private readonly agentGateway: AgentGateway,
        private readonly condinate: CondinateService,
        private readonly agentToolsService: AgentToolsService,
        private readonly history: ContextManager,
        private readonly cancellation: CancellationService,
        private readonly pendingConfirmationService: PendingConfirmationService,

        @InjectDataSource() private readonly dataSource: DataSource
    ) {

    }

    private pendingGenerators = new Map<string,{generator: AsyncGenerator<any, any, any>; context: PendingGeneratorType}>();
    public source:"telegram"|"whatsapp"|"web"="web"

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
    async segmentPromptIntoSubIntents(prompt: string, signal?: AbortSignal): Promise<string[]> {
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
- A line break (Enter/newline) MAY also separate two independent
  operations, similar to "ve" -- but it is a WEAKER signal than an
  explicit connective word, so apply the same judgment you would for
  "ve": only split there if each resulting side genuinely reads as a
  complete, independent operation request on its own. A line break used
  purely for readability -- e.g. a user listing several details/values of
  ONE operation on separate lines, or wrapping a long sentence -- is NOT
  a split point and must stay merged into a single segment.
- Keep parameters (names, values) attached to the segment they belong to.
- CRITICAL -- coordination with omitted (elided) parts: Turkish often
  coordinates two or more operation requests with "ve" (and) while
  omitting a repeated part that can be inferred from the other clause --
  this could be the verb, the object, the subject, or any other repeated
  element, and the omission can occur in EITHER clause (not only the
  first or only the last). Whenever a clause is missing a part that IS
  present in a sibling clause joined by "ve", reconstruct that clause
  into a complete sentence by copying the missing part from the sibling
  clause into its correct position. Every resulting segment must be
  fully self-contained -- nothing omitted, nothing implied, nothing left
  for the reader to infer from another segment. This rule applies
  generally, regardless of which specific part is shared or which
  clause it's omitted from.
- The input and output text must remain in Turkish -- you are only
  splitting the sentence structure, not translating, summarizing, or
  extracting keywords.

Examples:

Input: "Kategori 34" adıyla bir kategori kaydedin.
Output: { "segments": ["\\"Kategori 34\\" adıyla bir kategori kaydedin."] }
(One operation. The quoted name is a parameter, not a separate segment.)

Input: bir kullanıcı oluştur ve bir rol ekle
Output: { "segments": ["bir kullanıcı oluştur", "bir rol ekle"] }
(Two independent operations, split at "ve" -- nothing was omitted here.)

Input: AAA ürününü sil
Output: { "segments": ["AAA ürününü sil"] }
(One operation, nothing to split.)

Input: Kategori K 123 ve kategori K 56'yı kaydedin
Output: { "segments": ["Kategori K 123'ü kaydedin", "kategori K 56'yı kaydedin"] }
(The verb "kaydedin" was omitted from the first clause and only stated
in the second -- reconstructed by copying it into the first segment.)

Input: LmmmmmOP adında bir kategori oluşturun ve sil
Output: { "segments": ["LmmmmmOP adında bir kategori oluşturun", "LmmmmmOP adında bir kategori sil"] }
(The object "LmmmmmOP adında bir kategori" was omitted from the second
clause and only stated in the first -- reconstructed by copying it into
the second segment. Same underlying rule as the previous example, just
a different part omitted from the opposite clause.)

Input: LOP10000 adında bir kategori oluşturun
Sil
Output: { "segments": ["LOP10000 adında bir kategori oluşturun", "LOP10000 adında bir kategori sil"] }
(A line break separates two genuinely independent operations here --
"Sil" alone reads as a complete second command, missing only its
object, reconstructed from the first line via the same ellipsis rule.)

Input: Kod: PRD-500
Kategori: Elektronik
Ağırlık: 2.5
adıyla bir ürün oluştur
Output: { "segments": ["Kod: PRD-500\\nKategori: Elektronik\\nAğırlık: 2.5\\nadıyla bir ürün oluştur"] }
(These line breaks are NOT independent operations -- they are just the
details/parameters of ONE single "create product" request, listed on
separate lines for readability. Do not split; keep merged as one segment.)

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
            { headers: { "Content-Type": "application/json" }, signal }
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
    async createNewSession(userid: string): Promise<{ sessionId: string }> {
        const sessionRepo = this.dataSource.getRepository(ConversationSession);
        const submissionRepo = this.dataSource.getRepository(PromptSubmission);

        // آخرین session این کاربر رو پیدا کن (اگه از قبل وجود داشته باشه)
        const lastSession = await sessionRepo.findOne({
            where: { Userid: userid },
            order: { CreatedAt: "DESC" },
        });

        if (lastSession) {
            const submissionCount = await submissionRepo.count({
                where: { SessionId: lastSession.Id },
            });

            if (submissionCount === 0) {
                // این session هنوز هیچ prompt ای نگرفته -- همینو برگردون，
                // یک ردیف جدید و خالی دیگه نساز
                return { sessionId: lastSession.Id };
            }
        }

        // یا اصلاً session ای وجود نداشت، یا آخرین session قبلاً واقعاً استفاده شده
        const newSession = await sessionRepo.save({ Userid: userid });
        return { sessionId: newSession.Id };
    }

    private mapSessionToListItem(session: ConversationSession): { id: string; title: string; createdAt: Date } {
        return {
            id: session.Id,
            // اگه Title دستی ست نشده بود، از اولین prompt همون session استفاده کن
            title: session.Title || session.Submissions?.[0]?.RawPrompt?.slice(0, 50) || "Yeni Sohbet",
            createdAt: session.CreatedAt,
        };
    }

    async getUserSessions(userid: string): Promise<{ id: string; title: string; createdAt: Date }[]> {
        const sessions = await this.dataSource.getRepository(ConversationSession).find({
            where: { Userid: userid },
            order: { CreatedAt: "DESC" },
            relations: ["Submissions"], // برای اینکه بتونیم اولین prompt رو به‌عنوان عنوان استفاده کنیم
            take: 50
        });

        return sessions.map((session) => this.mapSessionToListItem(session));
    }

    /**
   * لیست متن‌های خام prompt های یک session خاص -- برای قابلیت کپی/reuse
   */
    async getSessionPrompts(
        sessionId: string,
        userid: string
    ): Promise<{ id: string; text: string; submittedAt: Date }[]> {
        // اول مالکیت رو چک کن -- دقیقاً همون منطق امنیتی که قبلاً توی
        // RunFunctionCalling نوشتیم
        const session = await this.dataSource.getRepository(ConversationSession).findOne({
            where: { Id: sessionId },
        });

        if (!session || session.Userid !== userid) {
            throw new Error("Bu oturuma erişim yetkiniz yok.");
        }

        const submissions = await this.dataSource.getRepository(PromptSubmission).find({
            where: { SessionId: sessionId },
            order: { SubmittedAt: "ASC" },
        });

        return submissions.map((s) => ({
            id: s.Id,
            text: s.RawPrompt,
            submittedAt: s.SubmittedAt,
        }));
    }
    /**
     * جزئیات کامل یک session (شامل نتایج اجرای ابزارها) -- برای پر کردن
     * دوباره‌ی پنل نتایج وقتی کاربر یک session قدیمی رو باز می‌کنه
     */
    async getSessionExecutions(
        sessionId: string,
        userid: string
    ): Promise<any[]> {
        const session = await this.dataSource.getRepository(ConversationSession).findOne({
            where: { Id: sessionId },
        });

        if (!session || session.Userid !== userid) {
            throw new Error("Bu oturuma erişim yetkiniz yok.");
        }

        const executions = await this.dataSource.getRepository(ToolExecution)
            .createQueryBuilder("execution")
            .innerJoin(PromptSubmission, "submission", "submission.Id = execution.SubmissionId")
            .where("submission.SessionId = :sessionId", { sessionId })
            .orderBy("execution.ExecutedAt", "DESC")
            .getMany();

        // تبدیل به دقیقاً همون فرمتی که frontend (FunctionCallResultType)
        // انتظار داره -- چون socketMapping و ساختار toolResult رو قبلاً
        // موقع اجرای زنده هم استفاده کرده بودیم، اینجا هم همون رو بازسازی می‌کنیم
        return executions.map((e) => ({
            id: e.Id,
            result: e.Status === "success" ? "success" : "error",
            prompt: e.SubIntentText, // متن دقیق درخواستی که این نتیجه رو تولید کرده
            message: e.Status === "success"
                ? socketMapping[`${e.Operation}_end`]
                : "İşlem gerçekleştirilirken hata oluştu.",
            continuePrompt: (e.Result as any)?.continuePrompt,
            toolName: undefined,
            //(e.Result as any)?.toolName,
            list: [],
            time: `${new Date(e.ExecutedAt).getHours()}:${new Date(e.ExecutedAt).getMinutes().toString().padStart(2, "0")}`,
        }));
    }


    isSpecial(toolname: string): boolean {
        switch (toolname) {
            case "create_tender":
                return true
            default:
                return false
        }
    }
    /**
     * منطق مشترک "اجرای ابزار انتخاب‌شده + ذخیره‌ی نتیجه + ارسال به کلاینت".
     * هم توی حلقه‌ی عادی RunFunctionCalling صدا زده می‌شه، هم بعداً برای
     * ادامه‌ی کار بعد از تایید یک عملیات معلق (مثل delete) استفاده می‌شه --
     * دقیقاً همون تابعی که برای هر دو مسیر لازم داشتیم.
     *
     * خروجی { success: boolean } رو برمی‌گردونه تا فراخوان (چه حلقه‌ی عادی،
     * چه مسیر resume) بتونه تصمیم بگیره آیا باید ادامه بده یا متوقف بشه.
     */
    async runFinalStep(
        subIntent: string,
        selectedToolName: string,
        selectedTool: { functionName: string; parameters: any },
        submission: { Id: string },
        req: any,
        files: string[],
        sessionId: string,
        isLastSegment: boolean,
        remainingSegments: string[],
        resumeIndex: number
    ): Promise<{ success: boolean; paused?: boolean}> {
        const userId = req.user.userid;
        const username = req.user.username;

        try {
            this.agentGateway.sendCurrentTool(userId, {
                currentOp: socketMapping[selectedToolName]
            });




            const execResult = await this.agentToolsService.executeTool(
                selectedTool.functionName,
                { ...selectedTool.parameters, files },
                req,
                sessionId
            );

               if (execResult.isGenerator) {
                return await this.driveHandler(execResult.generator!, {
                toolName: selectedToolName,
                 selectedTool:selectedTool,
                subIntent,
                sessionId,
                submissionId: submission.Id,
                req,
                files,
                resumeIndex,
                remainingSegments,
            });
        }
 const toolResult = execResult.result!;



            // قدم ۲: بعد از اجرای موفق، یک ToolExecution وصل به همون submission ذخیره کن
            await this.dataSource.getRepository(ToolExecution).save({
                SubmissionId: submission.Id,
                SubIntentText: subIntent,
                Operation: selectedToolName,
                Parameters: selectedTool.parameters,
                Result: toolResult,
                Status: "success",
            });

            // قدم ۲.۵: حافظه‌ی in-memory رو هم همین لحظه آپدیت کن
            this.history.addNewHistory({
                operation: selectedToolName,
                parameters: selectedTool.parameters,
                result: toolResult,
                status: "success",
            }, username, sessionId);

            this.agentGateway.sendToolResult(userId, {
                result: "success",
                message: socketMapping[`${selectedToolName}_end`],
                prompt: subIntent,
                continuePrompt: toolResult.continuePrompt,
                toolName: toolResult.toolName,
                lastsegment: isLastSegment,
                isSpecial: this.isSpecial(toolResult.toolName),
                list: []
            });
            this.agentGateway.broadcastDomainChange(await this.condinate.getDomainOfPreviousTool(selectedToolName), {})

            return { success: true };
        }
        catch (error: any) {
            // خطا هم باید ذخیره بشه -- تا هم history درست کار کنه، هم
            // بشه بعداً آمار خطاها رو بررسی کرد (مثل frequencyError)
            await this.dataSource.getRepository(ToolExecution).save({
                SubmissionId: submission.Id,
                SubIntentText: subIntent,
                Operation: selectedToolName,
                Parameters: {},
                Result: {},
                Status: "fault",
            });

            this.agentGateway.sendToolResult(userId, {
                result: "error",
                message: error?.message || "İşlem gerçekleştirilirken hata oluştu.",
                prompt: subIntent,
                continuePrompt: this.history.frequencyError(username, sessionId)
                    ? "Komut istemi ardı ardına hatalar veriyorsa, komut istemini değiştirin."
                    : undefined,
                toolName: undefined,
                isSpecial: false,
                lastsegment: true,
                list: []
            });

            return { success: false };
        }
    }

    async driveHandler(
    generator: AsyncGenerator<any, any, any>,
    context:PendingGeneratorType,
    resumeValue?: any
): Promise<{ success: boolean; paused?: boolean }> {
    const userId = context.req.user.userid;

    let result;
    try {
        result = resumeValue !== undefined
            ? await generator.next(resumeValue)
            : await generator.next();
    } catch (error: any) {
        await this.agentGateway.sendToolResult(userId, {
            result: "error",
            message: error?.message || "İşlem gerçekleştirilirken hata oluştu.",
            prompt: context.subIntent,
            toolName: undefined,
            isSpecial: false,
            lastsegment: true,
            continuePrompt:"",
            list: []
        });
        return { success: false };
    }

    if (!result.done) {
        this.pendingGenerators.set(userId, { generator, context });

        const request = result.value;
        this.agentGateway.sendToolResult(userId, {
            result: "confirm_required",
            message: request.message,
            data: request.options,
            continuePrompt:"",
            generatorType:request.type,
            isGenerator:true,
            prompt: context.subIntent,
            toolName: context.toolName,
            isSpecial: false,
            lastsegment: true,
            list: []
        });

        return { success: false, paused: true };
    }

    const toolResult = result.value;

    await this.dataSource.getRepository(ToolExecution).save({
        SubmissionId: context.submissionId,
        SubIntentText: context.subIntent,
        Operation: context.toolName,
        Parameters: {},
        Result: toolResult,
        Status: "success",
    });

    this.agentGateway.sendToolResult(userId, {
        result: "success",
        message: socketMapping[`${context.toolName}_end`],
        prompt: context.subIntent,
        continuePrompt: toolResult?.continuePrompt,
        toolName: toolResult?.toolName,
        isSpecial: false,
        lastsegment: context.resumeIndex >= context.remainingSegments.length,
        list: []
    });

    return { success: true };
}
async handleGeneratorResponse(userId: string, response: any): Promise<void> {
    const pending = this.pendingGenerators.get(userId);
    if (!pending) return;
    this.pendingGenerators.delete(userId);

    const { generator, context } = pending;

    const result = await this.driveHandler(generator, context, response);

    if (result.success && context.resumeIndex < context.remainingSegments.length) {
        const controller = this.cancellation.start(userId);
        await this.processSegments(
            context.remainingSegments,
            context.resumeIndex,
            { Id: context.submissionId },
            context.req,
            context.files,
            context.sessionId,
            controller
        );
    }
}


    /**
 * جستجو بین session های یک کاربر -- اگه متن جستجو توی SubIntentText،
 * Parameters یا Result یک ToolExecution پیدا بشه، session مربوطه
 * برگردونده می‌شه (با همون فرمتی که getUserSessions می‌ده).
 */
    async searchUserSessions(
        username: string,
        searchText: string
    ): Promise<{ id: string; title: string; createdAt: Date }[]> {
        const trimmed = searchText.trim();

        if (!trimmed) {
            return this.getUserSessions(username);
        }

        const likePattern = `%${trimmed}%`;

        const matchingSessionIds: { sessionId: string }[] = await this.dataSource.query(
            `SELECT DISTINCT ps."SessionId" AS "sessionId"
         FROM "ToolExecution" te
         INNER JOIN "PromptSubmission" ps ON ps."Id" = te."SubmissionId"
         INNER JOIN "ConversationSession" cs ON cs."Id" = ps."SessionId"
         WHERE cs."Username" = $1
           AND (
             te."SubIntentText" ILIKE $2
             OR te."Parameters"::text ILIKE $2
             OR te."Result"::text ILIKE $2
           );`,
            [username, likePattern]
        );

        if (matchingSessionIds.length === 0) {
            return [];
        }

        const ids = matchingSessionIds.map((r) => r.sessionId);

        const sessions = await this.dataSource.getRepository(ConversationSession).find({
            where: { Id: In(ids) },
            order: { CreatedAt: "DESC" },
            relations: ["Submissions"],
        });

        return sessions.map((session) => this.mapSessionToListItem(session));
    }


    async RunFunctionCalling(prompt: string, req: any, files: string[], sessionId: string): Promise<void> {
        const userId = req.user.userid;
        const username = req.user.username;

        // قدم صفر: مطمئن شو این sessionId واقعاً متعلق به همین کاربره --
        // بدون این چک، یک کاربر می‌تونه (اشتباهی یا عمداً) prompt خودش رو
        // توی session کاربر دیگه‌ای ذخیره کنه

        //#region ------------- Determine Session -----------------------
        const session = await this.dataSource.getRepository(ConversationSession).findOne({
            where: { Id: sessionId }
        });
        if (!session) {
            this.agentGateway.sendToolResult(userId, {
                result: "error",
                message: "Geçersiz oturum. Lütfen yeni bir sohbet başlatın.",
                prompt: prompt,
                continuePrompt: undefined,
                toolName: undefined,
                lastsegment: true,
                isSpecial: false,
                list: []
            });
            return;
        }
        if (session.Userid !== userId) {
            // این کاربر مالک این session نیست -- درخواست رو رد کن
            this.agentGateway.sendToolResult(userId, {
                result: "error",
                message: "Bu oturuma erişim yetkiniz yok.",
                prompt: prompt,
                continuePrompt: undefined,
                toolName: undefined,
                lastsegment: true,
                isSpecial: false,
                list: []
            });
            return;
        }
        //#endregion ----------- Determine Session -------------------------



        // Hydration خودکار: اگه این session هنوز توی این اجرای سرور لمس
        // نشده (اولین بار بعد از ری‌استارت سرور، یا اولین session قدیمی‌ای
        // که کاربر باز می‌کنه)، تاریخچه‌ش رو یک‌بار از دیتابیس بخون

        //#region ---------------- Get Session History ----------------------
        if (!this.history.hasSession(username, sessionId)) {
            const pastExecutions = await this.dataSource.getRepository(ToolExecution)
                .createQueryBuilder("execution")
                .innerJoin(PromptSubmission, "submission", "submission.Id = execution.SubmissionId")
                .where("submission.SessionId = :sessionId", { sessionId })
                .orderBy("execution.ExecutedAt", "DESC")
                .take(5)
                .getMany();

            const contextInfoList: ContextInfo[] = pastExecutions.reverse().map((e) => ({
                operation: e.Operation,
                parameters: e.Parameters,
                result: e.Result,
                status: e.Status as "success" | "fault",
            }));

            this.history.hydrate(username, sessionId, contextInfoList);
        }
        //#endregion ------------------- Get Session History ----------------------

        const controller = this.cancellation.start(userId);//For Cancel Run

        // قدم ۱: قبل از هر کاری، خود متن خام prompt رو ذخیره کن
        const submission = await this.dataSource.getRepository(PromptSubmission).save({
            SessionId: sessionId,
            RawPrompt: prompt,
        });


        try {
            await this.agentGateway.sendCurrentTool(userId, {
                currentOp: "Hazırlıkların yapılması"
            })


            const segmentsPrompts = await this.segmentPromptIntoSubIntents(prompt);

            await this.processSegments(segmentsPrompts, 0, submission, req, files, sessionId, controller);


            //             var currentsegmentIndex = 0;

            //             for (const subIntent of segmentsPrompts) {

            //                 if (controller.signal.aborted) {
            //                     this.agentGateway.sendToolResult(userId, {
            //                         result: "cancelled",
            //                         message: "İşlem kullanıcı tarafından durduruldu.",
            //                         prompt: subIntent,
            //                         continuePrompt: undefined,
            //                         toolName: undefined,
            //                         lastsegment: true,
            //                         isSpecial: false,
            //                         list: []
            //                     });
            //                     break;
            //                 }

            //                 this.agentGateway.sendCurrentTool(userId, {
            //                     currentOp: `(${subIntent})'nin emrini yerine getirmeye hazırlanıyoruz.`
            //                 })

            //                 currentsegmentIndex++;
            //                 const condinateToolsName = await this.condinate.getCondinateToolsForRunPrompt(subIntent, this.history.getPreviousTool(username, sessionId) as string)
            //                 const selectedToolName = await this.agentToolsService.extractSelectedTool(subIntent, condinateToolsName, this.history.getHistory(0, username, sessionId) as string);


            //                   if (selectedToolName.startsWith("delete_")) {
            //     // عملیات رو ذخیره کن، اجرا نکن -- منتظر تایید کاربر بمون


            //     this.pendingConfirmationService.set(userId, {
            //         files:files,
            //         isLastSegment:currentsegmentIndex==segmentsPrompts.length,
            //         req:req,
            //         selectedToolName:selectedToolName,
            //         submission:submission,
            //         subIntent,
            //         sessionId
            //     });

            //     this.agentGateway.sendToolResult(userId, {
            //         result: "confirm_required",
            //         message: `"${subIntent}" işlemini onaylıyor musunuz?`,
            //         continuePrompt: undefined,
            //         toolName: selectedToolName,
            //         isSpecial:false,
            //         prompt:subIntent,
            //         lastsegment: true,
            //         list: []
            //     });

            //     return; // اینجا متوقف می‌شیم -- تا کاربر تایید نکنه، ادامه نمی‌ره
            // }


            //                 const { success } = await this.runFinalStep(
            //                     subIntent,
            //                     selectedToolName,
            //                     submission,
            //                     req,
            //                     files,
            //                     sessionId,
            //                     currentsegmentIndex == segmentsPrompts.length
            //                 );

            //                 if (!success) {
            //                     break; // دقیقاً همون رفتار قبلی -- اگه خطا خورد، حلقه متوقف بشه
            //                 }

            //             }
        }

        catch (error: any) {
            if (error?.name === "CanceledError" || error?.name === "AbortError") {
                this.agentGateway.sendToolResult(userId, {
                    result: "cancelled",
                    message: "İşlem kullanıcı tarafından durduruldu.",
                    prompt: prompt,
                    continuePrompt: undefined,
                    toolName: undefined,
                    lastsegment: true,
                    isSpecial: false,
                    list: []
                });
            } else {
                this.agentGateway.sendToolResult(userId, {
                    result: "error",
                    message: "Kritik hata, lütfen operatörle iletişime geçin.",
                    prompt: prompt,
                    continuePrompt: undefined,
                    toolName: undefined,
                    lastsegment: true,
                    isSpecial: false,
                    list: []
                })
            }
        }
        finally {
            this.cancellation.finish(userId);
        }
    }


    /**
 * منطق حلقه‌ای که قبلاً مستقیم داخل RunFunctionCalling بود، الان اینجا
 * جدا شده -- چون هم مسیر عادی (startIndex=0)، هم resume بعد از تایید
 * حذف، هم resume بعد از تایید یک generator، همه باید بتونن از یک
 * نقطه‌ی مشخص (نه لزوماً صفر) این حلقه رو دوباره شروع کنن.
 */
    async processSegments(
        segmentsPrompts: string[],
        startIndex: number,
        submission: { Id: string },
        req: any,
        files: string[],
        sessionId: string,
        controller: AbortController
    ): Promise<void> {
        const userId = req.user.userid;
        const username = req.user.username;

        for (let i = startIndex; i < segmentsPrompts.length; i++) {
            const subIntent = segmentsPrompts[i];

            if (controller.signal.aborted) {
                this.agentGateway.sendToolResult(userId, {
                    result: "cancelled",
                    message: "İşlem kullanıcı tarafından durduruldu.",
                    prompt: subIntent,
                    continuePrompt: undefined,
                    toolName: undefined,
                    lastsegment: true,
                    isSpecial: false,
                    list: []
                });
                return;
            }

            this.agentGateway.sendCurrentTool(userId, {
                currentOp: `(${subIntent})'nin emrini yerine getirmeye hazırlanıyoruz.`
            });

            const condinateToolsName = await this.condinate.getCondinateToolsForRunPrompt(
                subIntent, this.history.getPreviousTool(username, sessionId) as string
            );
            const selectedToolName = await this.agentToolsService.extractSelectedTool(
                subIntent, condinateToolsName, this.history.getHistory(0, username, sessionId) as string
            );

            if (selectedToolName.startsWith("delete_")) {
                // حالا "بقیه‌ی segment ها" و "از کجا باید ادامه بدیم" رو هم
                // ذخیره می‌کنیم -- تا بعد از تایید، اگه segment دیگه‌ای هم
                // مونده بود، از دست نره
                this.pendingConfirmationService.set(userId, {
                    files: files,
                    isLastSegment: i === segmentsPrompts.length - 1,
                    req: req,
                    selectedToolName: selectedToolName,
                    submission: submission,
                    subIntent,
                    sessionId,
                    remainingSegments: segmentsPrompts, // ⬅️ جدید
                    resumeIndex: i + 1,                 // ⬅️ جدید
                    controller,                          // ⬅️ جدید (برای ساخت continuation)
                });

                this.agentGateway.sendToolResult(userId, {
                    result: "confirm_required",
                    message: `"${subIntent}" işlemini onaylıyor musunuz?`,
                    continuePrompt: undefined,
                    toolName: selectedToolName,
                    isSpecial: false,
                    prompt: subIntent,
                    lastsegment: true,
                    list: []
                });

                return;
            }

            const selectedTool = await this.agentToolsService.extractTools(
                subIntent, selectedToolName, this.history.getHistory(0, username, sessionId) as string
            );

            // پارامترهای جدید: کل لیست segment ها + اندیس بعدی -- برای
            // اینکه اگه handler خودش (به‌شکل generator) متوقف شد، بشه
            // بعداً درست از همینجا ادامه داد
            const { success, paused } = await this.runFinalStep(
                subIntent,
                selectedToolName,
                selectedTool,
                submission,
                req,
                files,
                sessionId,
                i === segmentsPrompts.length - 1,
                segmentsPrompts,
                i + 1
            );

            if (paused) {
                return;
            }

            if (!success) {
                break;
            }
        }
    }


}