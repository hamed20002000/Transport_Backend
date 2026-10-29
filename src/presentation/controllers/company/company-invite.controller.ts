import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { COMPANY_INVITE_PREFIX } from 'src/services/messengerBot/core/factoryInvite';
import { CompanyInviteService } from 'src/services/company/companyInvite.service';
import { isCompanyRole } from 'src/services/company/companyFeature.service';
import { messengerInvites } from 'src/services/company/inviteLinks';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

export class CreateCompanyInviteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MaxLength(20)
  mobile!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MaxLength(200)
  companyName?: string;
}

function companyUserId(request: AuthRequest): string {
  if (!request.user?.userId || !isCompanyRole(request.user.roles)) throw new ForbiddenException('onlyCompany');
  return request.user.userId;
}

/**
 * شرکت مادر: دعوت شخصی شرکت‌های حمل‌ونقل با شماره‌شان (حساب همان لحظه ساخته می‌شود)، با لینک وب (/join/…) و کد
 * پیام‌رسان‌ها (cmp_…) هر دعوت.
 */
@Controller('api/company/invites')
@UseGuards(JwtAuthGuard)
export class CompanyInviteController {
  constructor(
    private readonly invites: CompanyInviteService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@Req() request: AuthRequest) {
    const invites = await this.invites.list(companyUserId(request));
    return invites.map((invite) => ({ ...invite, messengers: this.messengers(invite.token) }));
  }

  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateCompanyInviteDto) {
    const invite = await this.invites.create(companyUserId(request), dto.mobile, dto.companyName);
    return { ...invite, messengers: this.messengers(invite.token) };
  }

  /** صفحه‌ی لینک برای کاربری که وارد شده: همان شماره‌ی دعوت‌شده است؟ */
  @Get(':token/membership')
  async membership(@Req() request: AuthRequest, @Param('token') token: string) {
    return { member: !!request.user?.userId && (await this.invites.isMember(request.user.userId, token)) };
  }

  private messengers(token: string) {
    return messengerInvites(this.config, `${COMPANY_INVITE_PREFIX}${token}`);
  }
}

/** صفحه‌ی لینک دعوت شرکت پیش از ورود: شرکت مادر و شماره‌ی دعوت‌شده (پوشیده). */
@Controller('api/company-invites')
export class CompanyInviteInfoController {
  constructor(private readonly invites: CompanyInviteService, private readonly config: ConfigService) {}

  // the sign-in page the link opens also offers the messengers, with this invite's code
  @Get(':token')
  async info(@Param('token') token: string) {
    const info = await this.invites.info(token);
    return { ...info, messengers: info.valid ? messengerInvites(this.config, `${COMPANY_INVITE_PREFIX}${token}`) : null };
  }
}
