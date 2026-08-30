import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("TelegramLink", { schema: "public" })
export class TelegramLink {
    @PrimaryGeneratedColumn("uuid")
    Id: string;

    @Column("varchar", { name: "Username" })
    Username: string;

    @Column("bigint", { name: "ChatId" })
    ChatId: string;
}