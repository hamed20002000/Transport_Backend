import { Column, Entity, Index, ManyToOne, JoinColumn, OneToMany, PrimaryGeneratedColumn, CreateDateColumn } from "typeorm";
import { ConversationSession } from "./ConversationSession";
import { ToolExecution } from "./ToolExecution";


@Entity("PromptSubmission", { schema: "public" })
export class PromptSubmission {
    @PrimaryGeneratedColumn("uuid")
    Id: string;

    @Column("uuid", { name: "SessionId" })
    @Index()
    SessionId: string;

    @ManyToOne(() => ConversationSession, (session) => session.Submissions)
    @JoinColumn({ name: "SessionId" })
    Session: ConversationSession;

    @Column("text", { name: "RawPrompt" }) // متن دقیق و کامل تایپ‌شده توسط کاربر
    RawPrompt: string;

    @CreateDateColumn({ name: "SubmittedAt" })
    SubmittedAt: Date;

    @OneToMany(() => ToolExecution, (execution) => execution.Submission)
    Executions: ToolExecution[];
}