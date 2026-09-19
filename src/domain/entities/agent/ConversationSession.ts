import { Column, Entity, Index, ManyToOne, JoinColumn, OneToMany, PrimaryGeneratedColumn, CreateDateColumn } from "typeorm";
import { PromptSubmission } from "./PromptSubmission";

/**
 * یک "جلسه‌ی کاری" (New Chat). هر بار کاربر روی دکمه‌ی New Chat کلیک
 * کنه، یک ردیف جدید اینجا ساخته می‌شه.
 */
@Entity("ConversationSession", { schema: "public" })
export class ConversationSession {
    @PrimaryGeneratedColumn("uuid")
    Id!: string;

    @Column("varchar", { name: "Userid" })
    @Index()
    Userid!: string;

    @Column("varchar", { name: "Title", nullable: true })
    Title?: string;

    @CreateDateColumn({ name: "CreatedAt" })
    CreatedAt?: Date;

    @OneToMany(() => PromptSubmission, (submission) => submission.Session)
    Submissions?: PromptSubmission[];
}