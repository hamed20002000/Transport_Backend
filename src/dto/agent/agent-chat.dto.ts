import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ATTACHMENT_ID_PATTERN } from 'src/presentation/controllers/agent/agent-uploads';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AgentSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sessionId!: string;
}

export class AgentTextMessageDto extends AgentSessionDto {
  @ApiProperty({ maxLength: 2000, example: 'یک بار از تهران به مشهد ثبت کن' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10, description: 'fileIdهایی که POST files برگردانده' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(ATTACHMENT_ID_PATTERN, { each: true, message: 'Invalid fileId.' })
  fileIds?: string[];
}

/**
 * فرم multipart: sessionId + فایل صوتی در فیلد `file`. خود فایل عمداً اینجا
 * property نیست؛ با forbidNonWhitelisted یک field بدون validator رد می‌شد.
 */
export class AgentVoiceMessageDto extends AgentSessionDto {}

export class AgentConfirmActionDto {
  @ApiProperty()
  @IsBoolean()
  confirmed!: boolean;
}
