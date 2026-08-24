
import { Column, Entity, Index, ManyToOne, JoinColumn, OneToMany, PrimaryGeneratedColumn, CreateDateColumn } from "typeorm";
import { PromptSubmission } from "./PromptSubmission";

/**
 * یک ردیف به‌ازای هر segment که واقعاً به یک ابزار اجراشده منجر شده.
 * یک PromptSubmission می‌تونه چند تا ToolExecution داشته باشه (وقتی
 * segmentation چند عملیات مستقل رو تشخیص داده باشه).
 */
@Entity("ToolExecution", { schema: "public" })
export class ToolExecution {
    @PrimaryGeneratedColumn("uuid")
    Id: string;

    @Column("uuid", { name: "SubmissionId" })
    @Index()
    SubmissionId: string;

    @ManyToOne(() => PromptSubmission, (submission) => submission.Executions)
    @JoinColumn({ name: "SubmissionId" })
    Submission: PromptSubmission;

    @Column("text", { name: "SubIntentText" }) // متن همون segment خاص (نه کل prompt)
    SubIntentText: string;

    @Column("varchar", { name: "Operation" }) // اسم ابزار، مثل "create_user"
    Operation: string;

    @Column("jsonb", { name: "Parameters", nullable: true })
    Parameters: Record<string, string>;

    @Column("jsonb", { name: "Result", nullable: true })
    Result: Record<string, string>;

    @Column("varchar", { name: "Status" }) // "success" | "fault"
    Status: string;

    @CreateDateColumn({ name: "ExecutedAt" })
    ExecutedAt: Date;
}