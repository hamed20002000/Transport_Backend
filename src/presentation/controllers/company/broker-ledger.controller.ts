import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CompanyFeatureGuard, RequireCompanyFeature } from 'src/auth/guards/companyFeature.guard';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { BrokerLedgerService } from 'src/services/company/brokerLedger.service';
import { isCompanyRole } from 'src/services/company/companyFeature.service';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

const latinDigits = (value: unknown) =>
  typeof value === 'string'
    ? value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s,٬]/g, '')
    : value;

export class CreateBrokerSettlementDto {
  // a decimal string keeps bigint amounts exact
  @Transform(({ value }) => latinDigits(value))
  @IsString() @Matches(/^[1-9][0-9]{0,17}$/, { message: 'مبلغ تسویه را با عدد درست وارد کنید.' })
  amount!: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

function companyUserId(request: AuthRequest): string {
  if (!request.user?.userId || !isCompanyRole(request.user.roles)) throw new ForbiddenException('onlyCompany');
  return request.user.userId;
}

/** شرکت حمل‌ونقل: حساب هر واسط روی بارهای خودش (رانندگان، سفرهای تحویل‌شده، کمیسیون، تسویه‌ها و مانده). */
@Controller('api/company/broker-ledger')
@UseGuards(JwtAuthGuard, CompanyFeatureGuard)
@RequireCompanyFeature(CompanyFeature.Drivers)
export class CompanyBrokerLedgerController {
  constructor(private readonly ledger: BrokerLedgerService) {}

  @Get()
  accounts(@Req() request: AuthRequest) {
    return this.ledger.accounts(companyUserId(request));
  }

  @Get(':brokerUserId')
  detail(@Req() request: AuthRequest, @Param('brokerUserId', ParseUUIDPipe) brokerUserId: string) {
    return this.ledger.detail(companyUserId(request), brokerUserId);
  }

  @Post(':brokerUserId/settlements')
  settle(@Req() request: AuthRequest, @Param('brokerUserId', ParseUUIDPipe) brokerUserId: string, @Body() dto: CreateBrokerSettlementDto) {
    const userId = companyUserId(request);
    return this.ledger.settle(userId, brokerUserId, dto.amount, dto.note ?? null, userId);
  }

  @Delete('settlements/:id')
  remove(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.ledger.removeSettlement(companyUserId(request), id);
  }
}
