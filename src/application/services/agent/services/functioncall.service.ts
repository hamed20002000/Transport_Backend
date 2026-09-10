import { Injectable } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChatRequest, Tool } from 'src/agent/types';
import axios from "axios";
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import { ToolRegister } from '../toolRegister';
import { AgentGateway } from '../agent.gateway';
import { CondinateService } from './condinate.service';
import { AgentToolsService } from './agentTools.service';
import { ContextManager } from '../contextManager';
import socketMapping from '../localFiles/socketMapping.json'
import { CancellationService } from './cancellation.service';
import { ConversationSession } from '../entities/ConversationSession';
import { PromptSubmission } from '../entities/PromptSubmission';
import { ToolExecution } from '../entities/ToolExecution';
import { ContextInfo, PendingGeneratorType, PendingAction } from '../types';
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

    //#region ----------- Define Local Props
    private pendingGenerators = new Map<string, { generator: AsyncGenerator<any, any, any>; context: PendingGeneratorType }>();
    public source: "telegram" | "whatsapp" | "web" = "web"
    isSpecial(toolname: string): boolean {
        switch (toolname) {
            case "create_tender":
                return true
            case "create_network":
                return true
            default:
                return false
        }
    }
    //#endregion ----------------------------


    //#region ---------------------Entry Function
    async RunFunctionCalling(prompt: string, req: any, files: string[], sessionId: string): Promise<void> {
        const userId = req.user.userid;
        const username = req.user.username;

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

        //#region save raw prompt to database ----------
        const submission = await this.dataSource.getRepository(PromptSubmission).save({
            SessionId: sessionId,
            RawPrompt: prompt,
        });
        //#endregion ------------------------------------

        try {
            await this.agentGateway.sendCurrentTool(userId, {
                currentOp: "Hazırlıkların yapılması"
            })
            const segmentsPrompts = await this.segmentPromptIntoSubIntents(prompt);
            await this.processSegments(segmentsPrompts, 0, submission, req, files, sessionId, controller);
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
    //#endregion --------------------------------



    //#region Two Step Prompt eg:delete&genreator Check For Continue
    public hasPendingGenerator(userId: string): boolean {
        return this.pendingGenerators.has(userId);
    }
    public hasPendingConfirmation(userId: string): boolean {
        return !!this.pendingConfirmationService.get(userId);
    }

    async resumePendingConfirmation(
        userId: string,
        confirmed: boolean
    ): Promise<{ success: boolean }> {
        const actionInfo: PendingAction = this.pendingConfirmationService.get(userId);
        if (!actionInfo) {
            return { success: false };
        }

        this.pendingConfirmationService.clear(userId);

        if (!confirmed) {
            this.agentGateway.sendToolResult(userId, {
                result: "cancelled",
                message: "İşlem kullanıcı tarafından iptal edildi.",
                prompt: actionInfo.subIntent,
                continuePrompt: "",
                toolName: actionInfo.selectedToolName,
                isSpecial: false,
                lastsegment: true,
                list: []
            });
            return { success: false };
        }

        const result = await this.runFinalStep(
            actionInfo.subIntent,
            actionInfo.selectedToolName,
            actionInfo.selectedTool,
            actionInfo.submission,
            actionInfo.req,
            actionInfo.files,
            actionInfo.sessionId,
            actionInfo.isLastSegment,
            actionInfo.remainingSegments,
            actionInfo.resumeIndex
        );

        if (result.success && actionInfo.resumeIndex < actionInfo.remainingSegments.length) {
            await this.processSegments(
                actionInfo.remainingSegments,
                actionInfo.resumeIndex,
                actionInfo.submission,
                actionInfo.req,
                actionInfo.files,
                actionInfo.sessionId,
                actionInfo.controller
            );
        }

        return result;
    }
    //#endregion -----------------------------------


    //#region Session Related Operation ------------
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
         WHERE cs."Userid" = $1
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
    //#endregion -----------------------------------

    //#region Genrator Section ----------------------
    async driveHandler(
        generator: AsyncGenerator<any, any, any>,
        context: PendingGeneratorType,
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
                continuePrompt: "",
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
                data: request,
                continuePrompt: "",
                isGenerator: true,
                prompt: context.subIntent,
                toolName: context.toolName,
                isSpecial: false,
                lastsegment: false,
                list: []
            });

            return { success: false, paused: true };
        }

        const toolResult = result.value;

        await this.dataSource.getRepository(ToolExecution).save({
            SubmissionId: context.submissionId,
            SubIntentText: context.subIntent,
            Operation: context.toolName,
            Parameters: context.selectedTool.parameters,
            Result: toolResult,
            Status: "success",
        });

        this.agentGateway.sendToolResult(userId, {
            result: "success",
            message: socketMapping[`${context.toolName}_end`],
            prompt: context.subIntent,
            continuePrompt: toolResult?.continuePrompt,
            toolName: toolResult?.toolName,
            isSpecial: this.isSpecial(toolResult?.toolName),
            lastsegment: context.resumeIndex >= context.remainingSegments.length,
            list: []
        });
        this.agentGateway.broadcastDomainChange(await this.condinate.getDomainOfPreviousTool(context.toolName), {})

        return { success: true };
    }

    async handleGeneratorResponse(userId: string, response: any, cancelled: boolean = false): Promise<void> {
        const pending = this.pendingGenerators.get(userId);
        if (!pending) return;
        this.pendingGenerators.delete(userId);

        const { generator, context } = pending;
        if (cancelled) {
            try {
                await generator.return(undefined);
            } catch {
            }

            this.agentGateway.sendToolResult(userId, {
                result: "cancelled",
                message: "İşlem kullanıcı tarafından iptal edildi.",
                prompt: context.subIntent,
                continuePrompt: "",
                toolName: context.toolName,
                isSpecial: false,
                lastsegment: true,
                list: []
            });

            return;
        }


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
    //#endregion ------------------------------------

    //#region principle Functions -------------------------------
    async segmentPromptIntoSubIntents(prompt: string, signal?: AbortSignal): Promise<string[]> {
        const systemPrompt = readFileSync(
            join(process.cwd(), 'src/application/services/agent/prompts/segmention.prompt'),
            'utf8'
        );
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
            const selectedTool = await this.agentToolsService.extractTools(
                subIntent, selectedToolName, this.history.getHistory(0, username, sessionId) as string
            );

            if (selectedToolName.startsWith("delete_")) {
                this.pendingConfirmationService.set(userId, {
                    files: files,
                    isLastSegment: i === segmentsPrompts.length - 1,
                    req: req,
                    selectedToolName: selectedToolName,
                    submission: submission,
                    selectedTool: selectedTool,
                    subIntent,
                    sessionId,
                    remainingSegments: segmentsPrompts, 
                    resumeIndex: i + 1,                 
                    controller,                          
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
    ): Promise<{ success: boolean; paused?: boolean }> {
        const userId = req.user.userid;
        const username = req.user.username;

        try {
            this.agentGateway.sendCurrentTool(userId, {
                currentOp: socketMapping[selectedToolName]
            });

            const execResult = await this.agentToolsService.executeTool(
                selectedTool.functionName ?? selectedToolName,
                { ...selectedTool.parameters, files },
                req,
                sessionId
            );

            if (execResult.isGenerator) {
                return await this.driveHandler(execResult.generator!, {
                    toolName: selectedToolName,
                    selectedTool: selectedTool,
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

            await this.dataSource.getRepository(ToolExecution).save({
                SubmissionId: submission.Id,
                SubIntentText: subIntent,
                Operation: selectedToolName,
                Parameters: selectedTool.parameters,
                Result: toolResult,
                Status: "success",
            });

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
    //#endregion ------------------------------------------------

















}