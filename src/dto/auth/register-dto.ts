import { normalizePhoneNumber } from './phone-number';
import { AccountType } from 'src/domain/enums/subscription';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** ثبت‌نام و ورود فقط با موبایل: درخواست کد OTP. */
export class RequestOtpDto {
  @ApiProperty({ example: '09123456789' })
  @Transform(({ value }) => normalizePhoneNumber(value))
  @IsString()
  @Matches(/^09[0-9]{9}$/)
  phoneNumber!: string;
}

/** بعد از تأیید شماره‌ای که حساب ندارد: نوع حساب. */
export class CompleteRegistrationDto {
  @ApiProperty({ description: 'registrationToken from otp/verify' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  registrationToken!: string;

  @ApiProperty({ enum: [AccountType.Driver, AccountType.Company] })
  @IsEnum(AccountType)
  accountType!: AccountType;
}
