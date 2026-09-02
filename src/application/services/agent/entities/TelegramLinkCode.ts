import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn } from "typeorm";

@Entity("TelegramLinkCode", { schema: "public" })
export class TelegramLinkCode {
    @PrimaryGeneratedColumn("uuid")
    Id: string;

    @Column("varchar", { name: "Code", length: 6 })
    Code: string;

    @Column("varchar", { name: "Userid" })
    Userid: string;

    @Column("boolean", { name: "Used", default: false })
    Used: boolean;

    @CreateDateColumn({ name: "CreatedAt" })
    CreatedAt: Date;
}