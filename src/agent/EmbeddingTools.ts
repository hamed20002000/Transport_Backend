// import { Column, Entity, Index, ManyToOne, JoinColumn } from "typeorm";
// import { ToolDomain } from "./ToolDomain";

// @Index("Embedding_pkey", ["Id"], { unique: true })
// @Entity("EmbeddingTool", { schema: "public" })
// export class EmbeddingTool {
//     @Column("uuid", { primary: true, name: "Id", generated: "uuid" })
//     Id: string;

//     @Column("character varying", { name: "ToolName", nullable: false })
//     ToolName: string;

//     @Column("text", { name: "Document" })
//     Document: string;

//     @Column({
//         name: "Embedding",
//         nullable: true,
//     })
//     Embedding: number[];

//     // ستون خام برای نگه‌داری DomainName (اگه بخوای بدون join مستقیم بخونیش)
//     @Column("text", { name: "DomainName", nullable: true })
//     DomainName: string;

//     // رابطه‌ی many-to-one با ToolDomain
//     // هر ابزار دقیقاً به یک domain تعلق داره (چون گفتی هیچ ابزاری بین دو domain مشترک نیست)
//     @ManyToOne(() => ToolDomain, (domain) => domain.Tools)
//     @JoinColumn({ name: "DomainName", referencedColumnName: "DomainName" })
//     Domain: ToolDomain;
// }