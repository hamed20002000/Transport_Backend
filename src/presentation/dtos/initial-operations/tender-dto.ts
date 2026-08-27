import { ApiProperty } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";
import { ItemListDto } from "../baseinfo/item.dto";
import { IsArray, IsDate, IsNumber, IsOptional, IsString, isString, ValidateNested } from "class-validator";
import { TenderCategories } from "src/domain/entities/TenderCategories";
import { tenderStatus } from "src/domain/enums/tenderstatus.enum";
import { AttachmentDto } from "./attachment-dto";

export class TenderListDto {
    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    id: number;
    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    title: string;

    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    createAt: Date;

    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    recordStatus: number;

    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    status: number | null;

    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    statusDate: Date | null;

    @ApiProperty({ type: () => [TenderCategories], description: 'Tender Categories ' })
    @Expose()
    @Type(() => TenderCategories)
    tenderDetails?: TenderCategories[];
}


export class CreateTenderDto {

    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    @IsString()
    title: string;
    @ApiProperty({ type: () => [CreateTenderCategoriesDto], description: 'Tender categories' })
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => CreateTenderCategoriesDto)
    @IsArray()
    tenderCategories?: CreateTenderCategoriesDto[];
    @ApiProperty({ type: () => [AttachmentDto], description: 'Attachments', nullable: true })
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => AttachmentDto)
    @IsArray()
    @IsOptional()
    attachments?: AttachmentDto[] | null;
}
export class CreateTenderCategoriesDto {

    @ApiProperty()
    @Expose()
    @IsString()
    title: string;

    @ApiProperty()
    @Expose()
    @IsString()
    eskiPoz: string;

    @ApiProperty()
    @Expose()
    @IsNumber()
    percent: number;

    @ApiProperty()
    @Expose()
    @IsString()
    description: string;

    @ApiProperty({ type: () => [CreateTenderDetailsDto], description: 'Tender Details' })
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => CreateTenderDetailsDto)
    @IsArray()
    details?: CreateTenderDetailsDto[];

}
export class CreateTenderDetailsDto {
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    eskiPoz: string;
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    tedas: string;
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    ana: string;
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    alt: string;


    @ApiProperty()
    @Expose()
    @IsNumber()
    firmProcuredItemQuantities: number;

    @ApiProperty()
    @Expose()
    @IsNumber()
    ourProcuredItemQuantities: number;

    @ApiProperty()
    @Expose()
    @IsNumber()
    demontaj: number;

    @ApiProperty()
    @Expose()
    @IsNumber()
    demontajMontaj: number;

    @ApiProperty()
    @Expose()
    @IsString()
    firmProcuredItemPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    ourProcuredItemPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    montajPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    demontajPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    demontajMontajPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    malzemeTutari: string;

    @ApiProperty()
    @Expose()
    @IsString()
    montajTutari: string;

    @ApiProperty()
    @Expose()
    @IsString()
    demontajTutari: string;

    @ApiProperty()
    @Expose()
    @IsString()
    dMMTutari: string;



    @ApiProperty()
    @Expose()
    @IsNumber()
    itemId: number;
}
export class UpdateTenderHeaderDto {
    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    @IsNumber()
    id: number;

    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    @IsOptional()
    @IsString()
    title: string;
    @ApiProperty({ description: 'RecordStatus' })
    @Expose()
    @IsNumber()
    @IsOptional()
    recordStatus: number;

    @ApiProperty({ type: () => [AttachmentDto], description: 'Attachments', nullable: true })
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => AttachmentDto)
    @IsArray()
    @IsOptional()
    attachments?: AttachmentDto[] | null;

}

export class UpdateTenderDto {
    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    @IsNumber()
    id: number;


    @ApiProperty({ type: () => [UpdateTendercategoriesDto], description: 'Tender Categories ' })
    @Expose()
    @IsOptional()
    @Type(() => UpdateTendercategoriesDto)
    categories?: UpdateTendercategoriesDto[];


}
export class UpdateTendercategoriesDto {
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    eskiPoz: string;
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    title: string;

    @ApiProperty()
    @Expose()
    @IsNumber()
    @IsOptional()
    percent: number;

    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    description: string;
    @ApiProperty({ type: () => [UpdateTenderDetailsDto], description: 'Tender Details ' })
    @Expose()
    @IsOptional()
    @Type(() => UpdateTenderDetailsDto)
    details?: UpdateTenderDetailsDto[];

}

export class UpdateTenderDetailsDto {

    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    eskiPoz: string;
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    tedas: string;
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    ana: string;
    @ApiProperty()
    @Expose()
    @IsString()
    @IsOptional()
    alt: string;

    @ApiProperty()
    @Expose()
    @IsNumber()
    firmProcuredItemQuantities: number;

    @ApiProperty()
    @Expose()
    @IsNumber()
    ourProcuredItemQuantities: number;

    @ApiProperty()
    @Expose()
    @IsNumber()
    demontaj: number;

    @ApiProperty()
    @Expose()
    @IsNumber()
    demontajMontaj: number;

    @ApiProperty()
    @Expose()
    @IsString()
    firmProcuredItemPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    ourProcuredItemPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    montajPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    demontajPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    demontajMontajPrice: string;

    @ApiProperty()
    @Expose()
    @IsString()
    malzemeTutari: string;

    @ApiProperty()
    @Expose()
    @IsString()
    montajTutari: string;

    @ApiProperty()
    @Expose()
    @IsString()
    demontajTutari: string;

    @ApiProperty()
    @Expose()
    @IsString()
    dMMTutari: string;

    @ApiProperty()
    @Expose()
    @IsNumber()
    itemId: number;
}


export class UpdateTenderstatusDto {
    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    @IsNumber()
    id: number;

    @ApiProperty({ description: 'tender-header Id' })
    @Expose()
    @IsNumber()
    status: tenderStatus;


}
