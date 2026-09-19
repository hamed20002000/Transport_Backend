import { Column, Entity, Index, OneToMany } from "typeorm";
import { EmbeddingTool } from "./EmbeddingTool";

@Index("ToolDomain_pkey", ["DomainName"], { unique: true })
@Entity("ToolDomain", { schema: "public" })
export class ToolDomain {
    @Column("text", { primary: true, name: "DomainName" })
    DomainName?: string;

    @Column("text", { name: "DisplayText", nullable: false })
    DisplayText?: string;

    // @Column({
    //     name: "Embedding",
    //     nullable: true,
    // })
    Embedding?: number[];

    // SearchVector یک ستون GENERATED هست (خودکار از DisplayText ساخته می‌شه)
    // پس هیچ‌وقت از سمت TypeORM بهش insert/update نمی‌زنیم.
    // select: false باعث می‌شه توی query های عادی هم لود نشه، چون معمولاً نیازی بهش نداری
    // و مستقیم توی raw SQL باهاش کار می‌کنیم (websearch_to_tsquery و غیره).
    @Column({
        name: "SearchVector",
        type: "tsvector" as any,
        nullable: true,
        insert: false,
        update: false,
        select: false,
    })
    SearchVector!: string;

    @OneToMany(() => EmbeddingTool, (tool) => tool.Domain)
    Tools?: EmbeddingTool[];
}