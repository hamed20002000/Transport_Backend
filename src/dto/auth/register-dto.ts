import { normalizePhoneNumber } from './phone-number';
import { AccountType } from 'src/domain/enums/subscription';
import { Transform } from 'class-transformer';
import { Matches, IsEnum, IsNotEmpty, IsString, MaxLength, MinLength, IsByteLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @ApiProperty({ example: '09123456789' })
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsString()
  @Matches(/^09[0-9]{9}$/)
  phoneNumber!: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  accountType!: AccountType;

  @ApiProperty({ maxLength: 100 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @ApiProperty({ minLength: 8, maxLength: 72, format: 'password', description: 'Maximum 72 UTF-8 bytes' })
  @IsString()
  @MinLength(8)
  @IsByteLength(0, 72)
  password!: string;
}
