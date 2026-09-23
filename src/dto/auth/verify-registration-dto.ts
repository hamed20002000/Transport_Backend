import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { normalizePhoneNumber } from './phone-number';

export class VerifyRegistrationDto {
  @ApiProperty({ example: '09123456789' })
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsString()
  @Matches(/^09[0-9]{9}$/)
  phoneNumber!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{96}$/)
  refreshToken!: string;
}
