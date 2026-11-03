import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CompanyFeatureGuard, RequireCompanyFeature } from 'src/auth/guards/companyFeature.guard';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { BrokerInviteService } from 'src/services/company/brokerInvite.service';
import { isCompanyRole } from 'src/services/company/companyFeature.service';
import { messengerInvites } from 'src/services/company/inviteLinks';
import { BROKER_INVITE_PREFIX } from 'src/services/messengerBot/core/factoryInvite';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

function companyUserId(request: AuthRequest): string {
  if (!request.user?.userId || !isCompanyRole(request.user.roles)) throw new ForbiddenException('onlyCompany');
  return request.user.userId;
}

export class CreateBrokerInviteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MaxLength(20)
  mobile!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MaxLength(200)
  brokerName?: string;
}

/**
 * شرکت حمل‌ونقل: دعوت شخصی واسط‌ها با شماره‌شان (حساب همان لحظه ساخته می‌شود)، با لینک وب (/broker-invite/…) و کد
 * پیام‌رسان‌های (brk_…) هر کدام. واسط مثل راننده روی بار درخواست می‌دهد، پس جزو بخش پولی «رانندگان» است.
 */
@Controller('api/company/broker-invites')
@UseGuards(JwtAuthGuard, CompanyFeatureGuard)
@RequireCompanyFeature(CompanyFeature.Drivers)
export class CompanyBrokerInviteController {
  constructor(
    private readonly invites: BrokerInviteService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@Req() request: AuthRequest) {
    const rows = await this.invites.list(companyUserId(request));
    return rows.map((row) => ({ ...row, messengers: this.messengers(row.token) }));
  }

  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateBrokerInviteDto) {
    const invite = await this.invites.create(companyUserId(request), dto.mobile, dto.brokerName);
    return { ...invite, messengers: this.messengers(invite.token) };
  }

  @Delete(':brokerUserId')
  remove(@Req() request: AuthRequest, @Param('brokerUserId', ParseUUIDPipe) brokerUserId: string) {
    return this.invites.remove(companyUserId(request), brokerUserId);
  }

  private messengers(token: string) {
    return messengerInvites(this.config, `${BROKER_INVITE_PREFIX}${token}`);
  }
}

/** صفحه‌ی لینک دعوت واسط: پیش از ورود شرکت و شماره‌ی دعوت‌شده (پوشیده)؛ بعد از ورود، همان شماره است؟ */
@Controller('api/broker-invites')
export class BrokerInviteInfoController {
  constructor(private readonly invites: BrokerInviteService, private readonly config: ConfigService) {}

  // the sign-in page the link opens also offers the messengers, with this invite's code
  @Get(':token')
  async info(@Param('token') token: string) {
    const info = await this.invites.info(token);
    return { ...info, messengers: info.valid ? messengerInvites(this.config, `${BROKER_INVITE_PREFIX}${token}`) : null };
  }

  @Get(':token/membership')
  @UseGuards(JwtAuthGuard)
  async membership(@Req() request: AuthRequest, @Param('token') token: string) {
    return { member: !!request.user?.userId && (await this.invites.isInvited(request.user.userId, token)) };
  }
}
