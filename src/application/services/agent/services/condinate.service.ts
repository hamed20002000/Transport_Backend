import { Injectable } from '@nestjs/common';
import { BaseService } from '../../base.service';
import { Roles } from 'src/domain/entities/Roles';
import { RoleRepository } from 'src/infrastructure/repositories/user/role.repository';
import { RoleMenuOperations } from 'src/domain/entities/RoleMenuOperations';
import { RoleMenuOperationRepository } from 'src/infrastructure/repositories/user/role-menu-operation.repository';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChatRequest, Tool } from 'src/agent/types';
import axios from "axios";
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import tables from 'src/agent/tables.json';
import schema from 'src/application/services/agent/schema.json';
import { extractRelations } from '../extractRelations';
import tools from 'src/application/services/agent/localFiles/tools.json';
import { CondinateToolsTyes, ExtracteToolsType } from '../types';
import { ToolRegister } from '../toolRegister';
import { RequestResult } from '../types';
import { DenseDomainResult, DomainLexemeEntry, LexemeStat, LexicalDomainResult } from '../interfaces/Ihybridsearch';


@Injectable()
export class CondinateService {
    constructor(
        private readonly toolRegister: ToolRegister,
        @InjectDataSource() private readonly dataSource: DataSource
    ) {

    }

    private idfMap: Map<string, number> = new Map();
    private domainTermFreq: Map<string, Map<string, number>> = new Map();
    private totalDomains = 0;
    private initialized = false;
    private SHORT_STEM_LENGTH_THRESHOLD = 3;
    private SHORT_STEM_DISCOUNT_FACTOR = 0.15; // یعنی فقط 15% از idf واقعی‌شون رو نگه می‌داریم



    async getEmbedding(text: string): Promise<number[]> {
        const resp = await axios.post("http://localhost:11434/api/embed", {
            model: "bge-m3:latest",
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

    async getCondinateToolsForRunPrompt(prompt: string, previousTool: string): Promise<string[]> {

        //const segmentsPrompts = await this.segmentPromptIntoSubIntents(prompt);
        const allCandidateTools = new Set<string>();

        //for (const subIntent of segmentsPrompts) {
        const domains = await this.getCondinateDomainForRunPrompt(prompt, previousTool);
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

    public async getDomainOfPreviousTool(previousToolName: string): Promise<string | null> {
        const result: { DomainName: string }[] = await this.dataSource.query(
            `SELECT "DomainName" FROM "EmbeddingTool" WHERE "ToolName" = $1 LIMIT 1;`,
            [previousToolName]
        );

        return result.length > 0 ? result[0].DomainName : null;
    }


    private reciprocalRankFusion(listA: string[], listB: string[], k: number = 60): string[] {
        const scores = new Map<string, number>();

        listA.forEach((name, index) => {
            const rank = index + 1;
            scores.set(name, (scores.get(name) ?? 0) + 1 / (k + rank));
        });

        listB.forEach((name, index) => {
            const rank = index + 1;
            scores.set(name, (scores.get(name) ?? 0) + 1 / (k + rank));
        });

        return Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name);
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
        limit: number
    ): Promise<{ name: string; score: number }[]> {
        const vec = await this.getEmbedding(queryText);

        const results: { DomainName: string; distance: number }[] = await this.dataSource.query(
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

    /**
     * این تابع رو یک‌بار موقع بالا اومدن سرویس، و هر بار بعد از
     * seed/update کردن ToolDomain، دوباره صدا بزن.
     */
    async refreshIndex(): Promise<void> {
        // ۱. تعداد کل domain ها
        const totalResult: { count: string }[] = await this.dataSource.query(
            `SELECT COUNT(*) FROM "ToolDomain";`
        );
        this.totalDomains = parseInt(totalResult[0].count, 10);

        // ۲. محاسبه‌ی IDF برای هر استم (بر اساس تعداد domain هایی که توشون حضور داره)
        // به‌جای فیلتر کردن کلمات خاص، یک تخفیف خودکار به استم‌های کوتاه
        // می‌دیم -- این قانون به‌طور خودکار روی هر مشکل مشابه در آینده هم
        // اعمال می‌شه، بدون نیاز به کشف و لیست کردن دستی کلمات جدید.
        const stats: LexemeStat[] = await this.dataSource.query(
            `SELECT word, ndoc FROM ts_stat('SELECT "SearchVector" FROM "ToolDomain"');`
        );

        this.idfMap = new Map(
            stats.map((s) => {
                const baseIdf = Math.log(1 + this.totalDomains / s.ndoc);
                const isShortStem = s.word.length <= this.SHORT_STEM_LENGTH_THRESHOLD;
                const finalIdf = isShortStem ? baseIdf * this.SHORT_STEM_DISCOUNT_FACTOR : baseIdf;
                return [s.word, finalIdf];
            })
        );

        // ۳. محاسبه‌ی TF (تعداد تکرار) هر استم داخل هر domain
        const domainLexemes: DomainLexemeEntry[] = await this.dataSource.query(
            `SELECT "DomainName" AS "domainName", t.lexeme, cardinality(t.positions) AS tf
             FROM "ToolDomain", unnest("SearchVector") AS t(lexeme, positions, weights);`
        );

        this.domainTermFreq = new Map();
        for (const entry of domainLexemes) {
            if (!this.domainTermFreq.has(entry.domainName)) {
                this.domainTermFreq.set(entry.domainName, new Map());
            }
            this.domainTermFreq.get(entry.domainName)!.set(entry.lexeme, entry.tf);
        }

        this.initialized = true;

        console.log(
            `Lexical index refreshed: ${this.totalDomains} domains, ${this.idfMap.size} unique stems.`
        );
    }

    /**
     * متن ورودی رو با همون stemmer ترکی پردازش می‌کنه و لیست lexeme ها رو برمی‌گردونه
     * (بدون هیچ فیلتر حذفی -- همه چی نگه داشته می‌شه، وزن‌دهی بعداً انجام می‌شه)
     */
    private async extractLexemes(text: string): Promise<string[]> {
        const rows: { lexeme: string }[] = await this.dataSource.query(
            `SELECT lexeme
             FROM unnest(to_tsvector('turkish', $1)) AS t(lexeme, positions, weights);`,
            [text]
        );
        return rows.map((r) => r.lexeme);
    }

    /**
     * جستجوی lexical با امتیازدهی TF-IDF -- جایگزین نسخه‌ی قبلی که
     * استم‌های پرتکرار رو کامل حذف می‌کرد.
     */
    async lexicalSearchDomainScored(
        queryText: string,
        limit: number
    ): Promise<{ name: string; score: number }[]> {
        if (!this.initialized) {
            await this.refreshIndex();
        }

        const queryLexemes = await this.extractLexemes(queryText);

        if (queryLexemes.length === 0) {
            return [];
        }

        const domainScores: { name: string; score: number }[] = [];

        for (const [domainName, termFreqMap] of this.domainTermFreq.entries()) {
            let score = 0;

            for (const lexeme of queryLexemes) {
                const tf = termFreqMap.get(lexeme);
                if (tf === undefined) continue; // این lexeme توی این domain نیست

                const idf = this.idfMap.get(lexeme) ?? 0;
                score += tf * idf;
            }

            if (score > 0) {
                domainScores.push({ name: domainName, score });
            }
        }

        return domainScores.sort((a, b) => b.score - a.score).slice(0, limit);
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


    /**
 * قبل از اینکه نتایج lexical (که امتیاز TF-IDF دارن) وارد RRF بشن،
 * باید نویز (match های خیلی ضعیف و تصادفی) رو حذف کنیم -- چون RRF
 * فقط به رتبه نگاه می‌کنه، نه به مقدار امتیاز، و یک match ضعیف در
 * رتبه‌ی ۱ (وقتی فقط ۱-۲ تا نتیجه‌ی ضعیف داریم) همون وزن یک match
 * قوی رو می‌گیره.
 *
 * threshold نسبی (نه مطلق) استفاده می‌کنیم چون scale امتیاز TF-IDF
 * بسته به طول و محتوای هر prompt متفاوته -- پس همیشه نسبت به
 * بهترین امتیاز همون کوئری می‌سنجیم، نه یک عدد ثابت.
 */
    private filterWeakLexicalMatches(
        scored: { name: string; score: number }[],
        relativeThreshold: number = 0.25
    ): { name: string; score: number }[] {
        if (scored.length === 0) return [];

        const topScore = scored[0].score; // چون از قبل مرتب‌شده (نزولی) برمی‌گرده
        if (topScore === 0) return [];

        return scored.filter((s) => s.score / topScore >= relativeThreshold);
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
            sentence unchanged as a single-element list.
            - Preserve the original wording in each segment as much as possible
            (split, don't rewrite or paraphrase).
            - Use Turkish connective words as split points: "ve" (and), "ile" (with),
            "sonra" (then), "ayrıca" (also), and commas separating distinct clauses.
            - Keep parameters (names, values) attached to the segment they belong to.
            - The input and output text must remain in Turkish -- you are only
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
        finalLimit: number = 2
    ): Promise<string[]> {
        const searchLimit = 8;

        const [denseFromPromptScored, lexicalFromPrompt] = await Promise.all([
            this.denseSearchDomainScored(prompt, searchLimit),
            this.lexicalSearchDomainScored(prompt, searchLimit),
        ]);

        const denseFromPrompt = denseFromPromptScored.map((d) => d.name);

        const filteredweakdomain = this.filterWeakLexicalMatches(lexicalFromPrompt).map(
            (item) => item.name
        );

        let combined = this.reciprocalRankFusion(denseFromPrompt, filteredweakdomain);

        // آستانه‌ی اطمینان dense -- اگه بالاترین شباهت dense به‌اندازه‌ی
        // کافی بالا بود (مثلاً بیشتر از 0.5)، یعنی حتی بدون کمک lexical،
        // می‌تونیم به dense اعتماد کنیم. این عدد رو باید با eval خودت
        // تنظیم کنی.
        const DENSE_CONFIDENCE_THRESHOLD = 0.5;
        const denseIsConfident =
            denseFromPromptScored.length > 0 &&
            denseFromPromptScored[0].score >= DENSE_CONFIDENCE_THRESHOLD;

        // حالا "مبهم بودن" رو درست‌تر تعریف می‌کنیم: فقط وقتی که هم
        // lexical شکست خورده هم dense به نتیجه‌ش مطمئن نیست -- نه صرفاً
        // چون lexical خالی برگشته (که ممکنه به‌خاطر یک باگ stemmer باشه،
        // نه چون prompt واقعاً بی‌محتواست)
        const promptIsAmbiguous = filteredweakdomain.length === 0 && !denseIsConfident;

        if (promptIsAmbiguous && previousToolName) {
            const previousDomain = await this.getDomainOfPreviousTool(previousToolName);

            if (previousDomain) {
                return [previousDomain];
            }
        }

        return combined.slice(0, finalLimit);
    }
}