import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AccountVerificationService, VerificationStatus } from 'src/services/company/accountVerification.service';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

const STATUSES: VerificationStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

export class RejectVerificationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MinLength(1) @MaxLength(500)
  reason!: string;
}

function userId(request: AuthRequest, roles: string[]): string {
  if (!request.user?.userId || !request.user.roles?.some((role) => roles.includes(role))) throw new ForbiddenException();
  return request.user.userId;
}

/** شرکت حمل‌ونقل یا کارخانه‌ی خودثبت‌نام‌کرده: وضعیت بررسی اعتبار و «درخواست بررسی اعتبار». */
@Controller('api/account/verification')
@UseGuards(JwtAuthGuard)
export class AccountVerificationController {
  constructor(private readonly verification: AccountVerificationService) {}

  @Get()
  state(@Req() request: AuthRequest) {
    return this.verification.state(userId(request, ['COMPANY', 'COMPANY_ADMIN', 'FACTORY']));
  }

  @Post()
  @HttpCode(200)
  request(@Req() request: AuthRequest) {
    return this.verification.request(userId(request, ['COMPANY', 'COMPANY_ADMIN', 'FACTORY']));
  }
}

/** شرکت مادر: درخواست‌های بررسی اعتبار با اطلاعات پروفایل، تأیید یا رد (با دلیل). */
@Controller('api/company/verifications')
@UseGuards(JwtAuthGuard)
export class CompanyVerificationController {
  constructor(private readonly verification: AccountVerificationService) {}

  /** پیش‌فرض: در انتظار. status=APPROVED یا REJECTED برای سابقه. */
  @Get()
  list(@Req() request: AuthRequest, @Query('status') status?: string) {
    const statuses = (status?.split(',') ?? ['PENDING']).filter((value): value is VerificationStatus => (STATUSES as string[]).includes(value));
    return this.verification.list(userId(request, ['COMPANY', 'COMPANY_ADMIN']), statuses.length ? statuses : ['PENDING']);
  }

  @Post(':userId/approve')
  @HttpCode(200)
  approve(@Req() request: AuthRequest, @Param('userId', ParseUUIDPipe) target: string) {
    return this.verification.approve(userId(request, ['COMPANY', 'COMPANY_ADMIN']), target);
  }

  @Post(':userId/reject')
  @HttpCode(200)
  reject(@Req() request: AuthRequest, @Param('userId', ParseUUIDPipe) target: string, @Body() dto: RejectVerificationDto) {
    return this.verification.reject(userId(request, ['COMPANY', 'COMPANY_ADMIN']), target, dto.reason);
  }
}
