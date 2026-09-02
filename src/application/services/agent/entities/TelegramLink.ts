import { UUID } from "node:crypto";
import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("TelegramLink", { schema: "public" })
export class TelegramLink {
    @PrimaryGeneratedColumn("uuid")
    Id: string;

    @Column("varchar", { name: "Userid" })
    Userid: string;

    @Column("bigint", { name: "ChatId" })
    ChatId: string;

    @UpdateDateColumn({ name: "LastVerifiedAt" })
    LastVerifiedAt: Date;
}