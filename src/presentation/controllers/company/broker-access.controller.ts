import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Put, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsUUID, Max, Min } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AccountVerificationService } from 'src/services/company/accountVerification.service';
import { BrokerAccessService, MAX_PACKAGES } from 'src/services/company/brokerAccess.service';
import { BROKER_ROLE } from 'src/services/notification/loadRequesters';
import { receiptUploadOptions } from './company-feature.controller';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

export class SelectBrokerCompaniesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID('all', { each: true })
  companyUserIds!: string[];
}

export class CreatePackageOrderDto {
  // multipart: a string on the wire
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PACKAGES)
  packages!: number;
}

function brokerUserId(request: AuthRequest): string {
  if (!request.user?.userId || !request.user.roles?.includes(BROKER_ROLE)) throw new ForbiddenException('onlyBroker');
  return request.user.userId;
}

/**
 * واسط: انتخاب شرکت‌هایی که بارشان را می‌بیند (تا سقف ادمین، بی‌پول) و خرید بسته‌ی درخواست بار با کارت‌به‌کارت و فیش،
 * در صف بررسی admin/broker-access/orders. بدون بررسی اعتبار حساب، چون دیدن قیمت و خرید همیشه باید ممکن باشد.
 */
@Controller('api/broker/access')
@UseGuards(JwtAuthGuard)
export class BrokerAccessController {
  constructor(
    private readonly access: BrokerAccessService,
    private readonly verification: AccountVerificationService,
    private readonly config: ConfigService,
  ) {}

  /** قواعد، شرکت‌های انتخاب‌شده و قابل انتخاب، درخواست‌های مانده، کارت پرداخت، آخرین خریدها و باز بودن دستیار. */
  @Get()
  async status(@Req() request: AuthRequest) {
    const userId = brokerUserId(request);
    const [status, approved, open] = await Promise.all([this.access.status(userId), this.verification.isApproved(userId), this.access.hasOpenAccess(userId)]);
    return {
      ...status,
      // the assistant: after the parent company's approval, and (while the admin limits the companies) with some picked
      agent: approved && open,
      payment: {
        cardNumber: this.config.get<string>('CARD_NO', ''),
        cardOwner: this.config.get<string>('CARD_OWNER', ''),
      },
    };
  }

  /** شرکت‌هایی که بارشان را می‌بیند؛ انتخاب تازه جای قبلی را می‌گیرد. */
  @Put('companies')
  async companies(@Req() request: AuthRequest, @Body() dto: SelectBrokerCompaniesDto) {
    const userId = brokerUserId(request);
    await this.access.selectCompanies(userId, dto.companyUserIds);
    return this.status(request);
  }

  /** خرید چند بسته‌ی درخواست بار با فیش (multipart: packages + file). */
  @Post('package-orders')
  @UseInterceptors(FileInterceptor('file', receiptUploadOptions))
  async packageOrder(@Req() request: AuthRequest, @Body() dto: CreatePackageOrderDto, @UploadedFile() file: Express.Multer.File | undefined) {
    const userId = brokerUserId(request);
    if (!file) throw new BadRequestException('عکس رسید پرداخت را انتخاب کنید.');
    await this.access.submitPackageOrder(userId, dto.packages, file.path);
    return this.status(request);
  }
}
