import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
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
  @Matches(/^[0-9]{4,10}$/)
  code!: string;

  /** the push endpoint this device already has, if any: the sign-in notice goes to the account's other devices */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pushEndpoint?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{96}$/)
  refreshToken!: string;
}

/** The admin panel's own sign-in (/auth/admin): username and password. */
export class AdminSignInDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
