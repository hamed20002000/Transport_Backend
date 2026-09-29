import { Injectable } from '@nestjs/common';
import { ChatRequest } from 'src/agent/types';
import axios from "axios";
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import { CondinateToolsTyes, ExtracteToolsType } from '../types';
import { ToolRegister } from '../toolRegister';
import { DenseDomainResult, DomainLexemeEntry, LexemeStat, LexicalDomainResult } from '../interfaces/Ihybridsearch';
import {
    buildLexicalIndex,
    DomainEntry,
    DOMAIN_FINAL_LIMIT,
    DOMAIN_SEARCH_LIMIT,
    DOMAIN_TEXT_SEARCH_CONFIG,
    EMBEDDING_MODEL,
    EMBEDDING_URL,
    rankDomains,
    scoreLexical,
} from '../domainRanking';


@Injectable()
export class CondinateService {
    constructor(
        private readonly toolRegister: ToolRegister,
        @InjectDataSource() private readonly dataSource: DataSource
    ) {

    }

    /** تعداد تکرار کلمه‌ها در توضیح هر domain همراه نقش‌هایش؛ idf برای هر نقش جدا ساخته می‌شود */
    private domains: DomainEntry[] = [];
    private loadedAt = 0;
    // ToolDomain با npm run agent:seed از process دیگری عوض می‌شود؛
    // index هر یک دقیقه دوباره خوانده می‌شود تا بدون restart به‌روز شود.
    private static readonly INDEX_TTL_MS = 60_000;



    async getEmbedding(text: string): Promise<number[]> {
        const resp = await axios.post(EMBEDDING_URL, {
            model: EMBEDDING_MODEL,
            input: text,
        });
        return resp.data.embeddings[0];
    }

    weightedCombine(vecPrompt: number[], vecHistory: number[], alpha: number): number[] {
        // alpha: وزن prompt فعلی (مثلاً 0.7 یعنی 70% وزن operation از prompt، 30% از history)
        const combined = vecPrompt.map((v, i) => alpha * v + (1 - alpha) * vecHistory[i]);

        // نرمال‌سازی به بردار واحد (L2 normalize)
        const norm = Math.sqrt(combined.reduce((sum, v) => sum + v * v, 0));
        return combined.map((v) => v / norm);
    }

    async getCondinateToolsForRunPrompt(prompt: string, previousTool: string, userRoles: string[]): Promise<string[]> {

        //const segmentsPrompts = await this.segmentPromptIntoSubIntents(prompt);
        const allCandidateTools = new Set<string>();

        //for (const subIntent of segmentsPrompts) {
        const domains = await this.getCondinateDomainForRunPrompt(prompt, previousTool, userRoles);
        const tools = await this.getCondinateToolsFromDomains(prompt, domains);
        tools.forEach((t) => allCandidateTools.add(t));
        //}

        // نکته‌ی مهم: prompt اصلی و کامل (نه segment ها) رو به extractSelectedTool
        // بیرون از این تابع بده -- چون اون تابع باید ترتیب و پارامترهای
        // درست رو از متن کامل و اصلی استخراج کنه، segment ها فقط برای
        // پیدا کردن کاندیدهای بیشتر (recall) استفاده شدن.
        return Array.from(allCandidateTools);



    }


     async getCondinateToolsFromDomains(
        prompt: string,
        domainNames: string[],
        limit: number = 15
    ): Promise<string[]> {
        if (domainNames.length === 0) {
            return [];
        }

        const vecPrompt = await this.getEmbedding(prompt);

        // نکته‌ی مهم: فیلتر روی DomainName با ANY($2) یعنی فقط داخل
        // ابزارهای domain هایی که مرحله‌ی قبل تشخیص داده جستجو می‌کنیم،
        // نه کل جدول -- این همون چیزیه که دقت مرحله‌ی دوم رو تضمین می‌کنه
        const results: CondinateToolsTyes[] = await this.dataSource.query(
            `SELECT "ToolName", "Embedding" <=> $1 AS distance
         FROM "EmbeddingTool"
         WHERE "DomainName" = ANY($2)
         ORDER BY "Embedding" <=> $1
         LIMIT $3;`,
            [`[${vecPrompt.join(",")}]`, domainNames, limit]
        );

        return results.map((item) => item.ToolName);
    }

    public async getDomainOfPreviousTool(previousToolName?: string|null): Promise<string | null> {
        const result: { DomainName: string }[] = await this.dataSource.query(
            `SELECT "DomainName" FROM "EmbeddingTool" WHERE "ToolName" = $1 LIMIT 1;`,
            [previousToolName]
        );

        return result.length > 0 ? result[0].DomainName : null;
    }


    private async denseSearchDomain_old(queryText: string, limit: number): Promise<{name:string,score:number}[]> {
        const vec = await this.getEmbedding(queryText);

        const results: DenseDomainResult[] = await this.dataSource.query(
            `SELECT "DomainName", "Embedding" <=> $1 AS distance
         FROM "ToolDomain"
         ORDER BY "Embedding" <=> $1
         LIMIT $2;`,
            [`[${vec.join(",")}]`, limit]
        );

        
        // distance بین 0 (کاملاً یکسان) تا 2 (کاملاً متضاد) هست؛
        // به شباهت (عدد بزرگ‌تر = بهتر) تبدیلش می‌کنیم تا با lexical هم‌جهت باشه
        return results.map((r) => ({ name: r.DomainName, score: 1 - r.distance }));
    }
        private async denseSearchDomainScored(
        queryText: string,
        limit: number,
        userRoles: string[]
    ): Promise<{ name: string; score: number }[]> {
        const vec = await this.getEmbedding(queryText);

        // فقط domainهای نقش کاربر (&& یعنی حداقل یک نقش مشترک)
        const results: { DomainName: string; distance: number }[] = await this.dataSource.query(
            `SELECT "DomainName", "Embedding" <=> $1 AS distance
             FROM "ToolDomain"
             WHERE "Roles" && $3::text[]
             ORDER BY "Embedding" <=> $1
             LIMIT $2;`,
            [`[${vec.join(",")}]`, limit, userRoles]
        );

        // distance بین 0 (کاملاً یکسان) تا 2 (کاملاً متضاد) هست؛
        // به شباهت (عدد بزرگ‌تر = بهتر) تبدیلش می‌کنیم تا با lexical هم‌جهت باشه
        return results.map((r) => ({ name: r.DomainName, score: 1 - r.distance }));
    }

    /**
     * این تابع رو یک‌بار موقع بالا اومدن سرویس، و هر بار بعد از
     * seed/update کردن ToolDomain، دوباره صدا بزن.
     */
    async refreshIndex(): Promise<void> {
        const rows: { name: string; roles: string[]; lexeme: string | null; tf: number | null }[] =
            await this.dataSource.query(
                `SELECT d."DomainName" AS name, d."Roles" AS roles, t.lexeme, cardinality(t.positions) AS tf
                 FROM "ToolDomain" d
                 LEFT JOIN LATERAL unnest(d."SearchVector") AS t(lexeme, positions, weights) ON true;`
            );

        const byName = new Map<string, DomainEntry>();
        for (const row of rows) {
            const entry = byName.get(row.name) ?? { name: row.name, roles: row.roles, termFreq: new Map() };
            if (row.lexeme !== null && row.tf !== null) entry.termFreq.set(row.lexeme, Number(row.tf));
            byName.set(row.name, entry);
        }
        this.domains = [...byName.values()];
        this.loadedAt = Date.now();

        console.log(`Lexical index refreshed: ${this.domains.length} domains.`);
    }

    /**
     * متن ورودی رو با همون پیکربندی SearchVector (simple) می‌شکنه و لیست lexeme ها رو برمی‌گردونه
     * (بدون هیچ فیلتر حذفی -- همه چی نگه داشته می‌شه، وزن‌دهی بعداً انجام می‌شه)
     */
    private async extractLexemes(text: string): Promise<string[]> {
        const rows: { lexeme: string }[] = await this.dataSource.query(
            `SELECT lexeme
             FROM unnest(to_tsvector($2::regconfig, $1)) AS t(lexeme, positions, weights);`,
            [text, DOMAIN_TEXT_SEARCH_CONFIG]
        );
        return rows.map((r) => r.lexeme);
    }

    /**
     * جستجوی lexical با امتیازدهی TF-IDF -- جایگزین نسخه‌ی قبلی که
     * استم‌های پرتکرار رو کامل حذف می‌کرد.
     */
    async lexicalSearchDomainScored(
        queryText: string,
        limit: number,
        userRoles: string[]
    ): Promise<{ name: string; score: number }[]> {
        if (Date.now() - this.loadedAt > CondinateService.INDEX_TTL_MS) {
            await this.refreshIndex();
        }

        const queryLexemes = await this.extractLexemes(queryText);

        return scoreLexical(buildLexicalIndex(this.domains, userRoles), queryLexemes, limit);
    }




    /**
     * جستجوی lexical روی ToolDomain - تطابق کلمه‌به‌کلمه با SearchVector
     * این بخش دقیقاً همون چیزیه که سیگنال‌های قوی مثل "direk" یا "kaydı" رو
     * مستقل از فهم معنایی مدل تضمین می‌کنه.
     */
    private async lexicalSearchDomain_Old(queryText: string, limit: number): Promise<string[]> {
        const results: LexicalDomainResult[] = await this.dataSource.query(
            `SELECT "DomainName",
                ts_rank("SearchVector", websearch_to_tsquery('simple', $1)) AS rank
         FROM "ToolDomain"
         WHERE "SearchVector" @@ websearch_to_tsquery('simple', $1)
         ORDER BY rank DESC
         LIMIT $2;`,
            [queryText, limit]
        );

        return results.map((r) => r.DomainName);
    }


    async segmentPromptIntoSubIntents(prompt: string): Promise<string[]> {
        const systemPrompt = `
            You are a text segmentation assistant.

            Your task: if the user's message (in Persian/Farsi) contains multiple independent
            operation requests, split them into separate sentences. Each resulting
            sentence must be self-contained and represent one independent operation
            request.

            Rules:
            - If the message contains only ONE operation request, return the original
            sentence unchanged as a single-element list.
            - Preserve the original wording in each segment as much as possible
            (split, don't rewrite or paraphrase).
            - Use Persian connective words as split points: "و" (and), "بعد" / "سپس"
            (then), "همچنین" (also), and commas separating distinct clauses.
            - Keep parameters (names, values) attached to the segment they belong to.
            - The input and output text must remain in Persian -- you are only
            splitting the sentence structure, not translating or altering content.

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

        // fallback ایمنی: اگه به هر دلیلی خالی برگشت، خود prompt اصلی رو برگردون
        return result.segments && result.segments.length > 0 ? result.segments : [prompt];
    }

    // async resolveCandidateToolsForPrompt(
    //     prompt: string,
    //     history: string,
    //     previousToolName: string | null
    // ): Promise<string[]> {
    //     const subIntents = await this.segmentPromptIntoSubIntents(prompt, history);

    //     const allCandidateTools = new Set<string>();

    //     for (const subIntent of subIntents) {
    //         const domains = await this.getCondinateDomainForRunPrompt(subIntent, previousToolName);
    //         // const tools = await this.getCondinateToolsFromDomains(subIntent, domains);
    //         //tools.forEach((t) => allCandidateTools.add(t));
    //     }

    //     // نکته‌ی مهم: prompt اصلی و کامل (نه segment ها) رو به extractSelectedTool
    //     // بیرون از این تابع بده -- چون اون تابع باید ترتیب و پارامترهای
    //     // درست رو از متن کامل و اصلی استخراج کنه، segment ها فقط برای
    //     // پیدا کردن کاندیدهای بیشتر (recall) استفاده شدن.
    //     return Array.from(allCandidateTools);
    // }

    async getCondinateDomainForRunPrompt(
        prompt: string,
        previousToolName: string | null,
        userRoles: string[],
        finalLimit: number = DOMAIN_FINAL_LIMIT
    ): Promise<string[]> {
        const [denseFromPromptScored, lexicalFromPrompt] = await Promise.all([
            this.denseSearchDomainScored(prompt, DOMAIN_SEARCH_LIMIT, userRoles),
            this.lexicalSearchDomainScored(prompt, DOMAIN_SEARCH_LIMIT, userRoles),
        ]);

        // "مبهم" فقط وقتی است که هم lexical شکست خورده هم dense مطمئن نیست --
        // نه صرفاً چون lexical خالی برگشته.
        const { ranked, ambiguous } = rankDomains(denseFromPromptScored, lexicalFromPrompt);

        if (ambiguous && previousToolName) {
            const previousDomain = await this.getDomainOfPreviousTool(previousToolName);

            if (previousDomain) {
                return [previousDomain];
            }
        }

        return ranked.slice(0, finalLimit);
    }
}