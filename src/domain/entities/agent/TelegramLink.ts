import { UUID } from "node:crypto";
import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("TelegramLink", { schema: "public" })
export class TelegramLink {
    @PrimaryGeneratedColumn("uuid")
    Id!: string;

    @Column("varchar", { name: "Userid" })
    Userid!: string;

    @Column("bigint", { name: "ChatId" })
    ChatId!: string;

    @UpdateDateColumn({ name: "LastVerifiedAt" })
    LastVerifiedAt?: Date;

    // جدید: session جاری این چت -- تا وقتی خالی نشه (یا کاربر /yeni بزنه)،
    // همه‌ی پیام‌های این چت به همین session وصل می‌مونن (معادل رفتار
    // فرانت‌اند وب که یک sessionId رو تا "چت جدید" نگه می‌داره).
    @Column("varchar", { name: "CurrentSessionId", nullable: true })
    CurrentSessionId?: string | null;
}