
import Tools from '../agent/localFiles/tools.json'

export type Property = {
    type: string
    description: string
}

export type Parameters = {
    type: string
    properties: Record<string, Property>
    required: string[]
}


export type Function = {
    name: string,
    description: string
    parameters: Parameters
}

export type Tool = {
    type: string
    function: Function
}




export type Message = {
    role: string,
    content: string
}

export type ChatRequest = {
    model: string,
    messages: Message[],
    stream: boolean,
    tools?: Tool[],
    options?: {
        temperature: number,
        top_p: number,
        repeat_penalty: number
    }
}

export type ChatResponse = {
    message: {
        content: string,
    }
}

export type CondinateToolsTyes = {
    ToolName: string,
    Embedding: number[]
}

export type ExtracteToolsType = {
    functionName: string,
    confidence: number,
    parameters: any
}

export type ToolHandlerType = {
    functionName: string,
    handler: (params: any) => Promise<any>|AsyncGenerator<any,any,any>;
}


export type ContextInfo = {
    operation: string;
    result: Record<string, string>;
    parameters: Record<string, string>;
    status: "success" | "fault",
    domain?: string
}

export type RequestResult = {
    toolName: string;
    continuePrompt?: string;
    /**
     * پاسخی که به کاربر نشان داده می‌شود (مثلاً لیست بارها)؛ اگر نباشد متن ثابت
     * socketMapping[`${toolName}_end`] فرستاده می‌شود. در تلگرام و واتس‌اپ که
     * صفحه‌ی جداگانه‌ای نیست، ابزارهای خواندنی فقط از همین راه جواب می‌دهند.
     */
    message?: string;
}

export type ExecuteToolResultType={
    isGenerator: boolean;
    generator?: AsyncGenerator<any, any, any>;
    result?: RequestResult;
}

export type GeneratorDataType={
    data:any,
    type:"selection",
    label:string
}
export type FunctionCallResultType = {
    result: "error" | "success" | "cancelled"|"confirm_required",
    message?: string,
    prompt: string,
    continuePrompt: string | undefined,
    toolName?: string,
    lastsegment: boolean,
    isSpecial: boolean,
    isGenerator?:boolean,
    data?:GeneratorDataType,
    list: any[],
    source?:"telegram"|"web"|"whatsapp"
}

export type EmbeddingToolType = {
    tool_name: string;
    embedding_text: string;
    domain_name: string
}
export type EmbeddingDomainTool = {
    domain_name: string;
    /** نقش‌هایی که این domain برایشان است؛ domain بدون نقش برای هیچ کاربری دیده نمی‌شود */
    roles: string[];
    embedding_text: string
}

export type RunFinalStepType = {
    subIntent: string,
    selectedToolName: string,
    selectedTool: { functionName: string; parameters: any },
    submission: { Id: string },
    req: AgentRequest,
    files: string[],
    sessionId: string,
    isLastSegment: boolean

}

export interface PendingAction {
        subIntent: string,
        selectedToolName: string,
        selectedTool?: { functionName: string; parameters: any },
        submission: { Id: string },
        req: AgentRequest,
        files: string[],
        sessionId: string,
        isLastSegment: boolean
        remainingSegments: string[], 
        resumeIndex:number,                
        controller:AbortController
}

export type PendingGeneratorType={
    toolName: string;
    subIntent: string;
    sessionId: string;
    submissionId: string;
    selectedTool: { functionName: string; parameters: any };
    req: AgentRequest;
    files: string[];
    resumeIndex: number;
    remainingSegments: string[];
}

/** کانالی که درخواست agent از آن آمده؛ نتیجه به همان کانال برگردانده می‌شود. */
export type AgentSource = 'telegram' | 'whatsapp' | 'web';

/**
 * هویت کاربر در کل pipeline agent. شکلش با JwtPayload یکی است تا request
 * واقعی HTTP و requestی که تلگرام/واتس‌اپ می‌سازند یکسان خوانده شوند.
 */
export interface AgentRequest {
    /**
     * roles را FunctionCallService در شروع هر اجرا از دیتابیس پر می‌کند (نه از
     * کلاینت)؛ domainهای agent بر اساس همین فیلتر می‌شوند.
     */
    user: { userId: string; username: string; roles?: string[] };
}
