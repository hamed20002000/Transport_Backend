import { Controller, DefaultValuePipe, ForbiddenException, Get, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { BrokerDriversService } from 'src/services/company/brokerDrivers.service';
import { isCompanyRole } from 'src/services/company/companyFeature.service';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

/** شرکت مادر: همه‌ی راننده‌هایی که واسط‌ها برایشان درخواست بار داده‌اند، با همه‌ی مشخصات و درخواست‌هایشان. */
@Controller('api/company/broker-drivers')
@UseGuards(JwtAuthGuard)
export class CompanyBrokerDriversController {
  constructor(private readonly drivers: BrokerDriversService) {}

  @Get()
  list(
    @Req() request: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('search') search?: string,
  ) {
    if (!request.user?.userId || !isCompanyRole(request.user.roles)) throw new ForbiddenException('onlyCompany');
    return this.drivers.list(request.user.userId, Math.max(page, 1), Math.min(Math.max(pageSize, 1), 50), search);
  }
}
