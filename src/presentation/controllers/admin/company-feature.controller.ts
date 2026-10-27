import { resolve } from 'path';
import { Body, Controller, Delete, Get, Headers, HttpCode, Logger, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { CompanyFeatureService } from 'src/services/company/companyFeature.service';
import { ReceiptAccessService } from 'src/services/subscription/receiptAccess.service';
import { isStoredReceipt } from 'src/services/subscription/receiptStorage';
import { requireAdmin } from './subscription-policy.controller';
import { RejectReceiptDto } from './subscription-order.controller';

type AdminRequest = Parameters<typeof requireAdmin>[0];

export class SetParentCompanyDto {
  @IsBoolean()
  isParent!: boolean;
}

export class CreateCompanyFeaturePlanDto {
  @IsEnum(CompanyFeature)
  feature!: CompanyFeature;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(150)
  title!: string;

  @IsInt() @Min(1) @Max(3650)
  durationDays!: number;

  // A decimal string keeps bigint amounts exact across JSON and JavaScript.
  @IsString() @Matches(/^(0|[1-9][0-9]{0,17})$/)
  price!: string;

  @IsIn(['IRR', 'GBP', 'EUR', 'SAR', 'CNY'])
  currency: string = 'IRR';

  @IsInt() @Min(0) @Max(2147483647)
  sortOrder: number = 0;
}

export class GrantCompanyFeatureDto {
  @IsEnum(CompanyFeature)
  feature!: CompanyFeature;

  @IsInt() @Min(1) @Max(3650)
  days!: number;
}

/** شرکت مادر، قیمت منوهای شرکت‌های غیرمادر و بررسی فیش خرید آن‌ها. */
@Controller('api/admin/company-features')
@UseGuards(JwtAuthGuard)
export class CompanyFeatureAdminController {
  private readonly logger = new Logger(CompanyFeatureAdminController.name);

  constructor(
    private readonly features: CompanyFeatureService,
    private readonly receiptAccess: ReceiptAccessService,
  ) {}

  @Get('companies')
  companies(@Req() request: AdminRequest) {
    requireAdmin(request);
    return this.features.listCompanies();
  }

  @Patch('companies/:userId/parent')
  setParent(@Req() request: AdminRequest, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: SetParentCompanyDto) {
    requireAdmin(request);
    return this.features.setParent(userId, dto.isParent);
  }

  /** وضعیت منوهای یک شرکت، همان که خودش در صفحه‌ی خرید می‌بیند. */
  @Get('companies/:userId')
  companyStatus(@Req() request: AdminRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    requireAdmin(request);
    return this.features.status(userId);
  }

  @Post('companies/:userId/grants')
  grant(@Req() request: AdminRequest, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: GrantCompanyFeatureDto) {
    const adminUserId = requireAdmin(request)!;
    return this.features.grant(userId, dto.feature, dto.days, adminUserId);
  }

  @Get('plans')
  plans(@Req() request: AdminRequest) {
    requireAdmin(request);
    return this.features.activePlans();
  }

  @Post('plans')
  createPlan(@Req() request: AdminRequest, @Body() dto: CreateCompanyFeaturePlanDto) {
    requireAdmin(request);
    return this.features.createPlan(dto);
  }

  @Delete('plans/:id')
  removePlan(@Req() request: AdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    requireAdmin(request);
    return this.features.deactivatePlan(id);
  }

  /** پیش‌فرض: سفارش‌های منتظر بررسی. */
  @Get('orders')
  orders(@Req() request: AdminRequest, @Query('status') status?: string) {
    requireAdmin(request);
    const statuses = status
      ? status.split(',').filter((value): value is SubscriptionOrderStatus => (Object.values(SubscriptionOrderStatus) as string[]).includes(value))
      : [SubscriptionOrderStatus.ReceiptSubmitted];
    return this.features.listOrders(statuses);
  }

  /** عکس فیش: مثل رسید اشتراک، فقط با رمز رسیدها (X-Receipt-Token از admin/subscription-orders/receipts/unlock). */
  @Get('orders/:orderId/receipt')
  async receipt(
    @Req() request: AdminRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Headers('x-receipt-token') token: string | undefined,
    @Res() response: Response,
  ) {
    const adminUserId = requireAdmin(request)!;
    await this.receiptAccess.assertUnlocked(adminUserId, token);
    const order = await this.features.findOrder(orderId);
    const file = order?.receiptPath ? resolve(order.receiptPath) : null;
    if (!file || !isStoredReceipt(file)) throw new NotFoundException('Receipt image not found');
    this.logger.log(`Admin ${adminUserId} viewed the receipt of feature order ${orderId}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.sendFile(file, (error) => {
      if (error && !response.headersSent) response.status(404).end();
    });
  }

  @Post('orders/:orderId/approve')
  @HttpCode(200)
  approve(@Req() request: AdminRequest, @Param('orderId', ParseUUIDPipe) orderId: string) {
    const adminUserId = requireAdmin(request)!;
    return this.features.approveOrder(orderId, adminUserId);
  }

  @Post('orders/:orderId/reject')
  @HttpCode(200)
  reject(@Req() request: AdminRequest, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: RejectReceiptDto) {
    const adminUserId = requireAdmin(request)!;
    return this.features.rejectOrder(orderId, adminUserId, dto.reason);
  }
}
