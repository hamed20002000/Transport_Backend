import { resolve } from 'path';
import { Body, Controller, Get, Headers, HttpCode, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { BrokerAccessService } from 'src/services/company/brokerAccess.service';
import { ReceiptAccessService } from 'src/services/subscription/receiptAccess.service';
import { isStoredReceipt } from 'src/services/subscription/receiptStorage';
import { requireAdmin } from './subscription-policy.controller';
import { RejectReceiptDto } from './subscription-order.controller';

type AdminRequest = Parameters<typeof requireAdmin>[0];

export class UpdateBrokerAccessPolicyDto {
  /** واسط تا این تعداد شرکت انتخاب می‌کند؛ null: بار همه‌ی شرکت‌ها */
  @IsOptional() @IsInt() @Min(1) @Max(1000)
  maxCompanies: number | null = null;

  /** خاموش = درخواست بار رایگان */
  @IsBoolean()
  packagesEnabled!: boolean;

  /** درخواست‌های هر بسته */
  @IsInt() @Min(1) @Max(100_000)
  packageSize!: number;

  // A decimal string keeps bigint amounts exact across JSON and JavaScript.
  @IsString() @Matches(/^(0|[1-9][0-9]{0,17})$/)
  packagePrice!: string;

  @IsIn(['IRR', 'GBP', 'EUR', 'SAR', 'CNY'])
  currency: string = 'IRR';

  /** «معرفی راننده»: خاموش یعنی واسط نمی‌تواند بخواهد */
  @IsOptional() @IsBoolean()
  suggestionsEnabled: boolean = false;

  /** معرفی‌های هر بسته */
  @IsOptional() @IsInt() @Min(1) @Max(100_000)
  suggestionPackageSize: number = 10;

  @IsOptional() @IsString() @Matches(/^(0|[1-9][0-9]{0,17})$/)
  suggestionPackagePrice: string = '0';

  /** هر معرفی به چند راننده خبر می‌دهد */
  @IsOptional() @IsInt() @Min(1) @Max(50)
  suggestionDrivers: number = 5;
}

/** Load requests given to a broker without a purchase. */
export class GrantBrokerRequestsDto {
  @IsInt() @Min(1) @Max(100_000)
  requests!: number;

  /** REQUEST (default): load requests; SUGGESTION: «معرفی راننده» */
  @IsOptional() @IsIn(['REQUEST', 'SUGGESTION'])
  pack: 'REQUEST' | 'SUGGESTION' = 'REQUEST';
}

/** قواعد واسط (سقف شرکت، بسته‌ی درخواست)، بررسی فیش‌ها و درخواست بی‌خرید (هدیه) برای یک واسط. */
@Controller('api/admin/broker-access')
@UseGuards(JwtAuthGuard)
export class BrokerAccessAdminController {
  private readonly logger = new Logger(BrokerAccessAdminController.name);

  constructor(
    private readonly access: BrokerAccessService,
    private readonly receiptAccess: ReceiptAccessService,
  ) {}

  @Get('policy')
  policy(@Req() request: AdminRequest) {
    requireAdmin(request);
    return this.access.getPolicy();
  }

  @Put('policy')
  setPolicy(@Req() request: AdminRequest, @Body() dto: UpdateBrokerAccessPolicyDto) {
    const adminUserId = requireAdmin(request)!;
    return this.access.setPolicy({ ...dto, maxCompanies: dto.maxCompanies ?? null }, adminUserId);
  }

  @Get('brokers')
  brokers(@Req() request: AdminRequest) {
    requireAdmin(request);
    return this.access.listBrokers();
  }

  /** شرکت‌های انتخاب‌شده و درخواست‌های مانده‌ی یک واسط، همان که خودش در صفحه‌اش می‌بیند. */
  @Get('brokers/:userId')
  brokerStatus(@Req() request: AdminRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    requireAdmin(request);
    return this.access.status(userId);
  }

  @Post('brokers/:userId/requests')
  grantRequests(@Req() request: AdminRequest, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: GrantBrokerRequestsDto) {
    requireAdmin(request);
    return this.access.grantRequests(userId, dto.requests, dto.pack);
  }

  /** پیش‌فرض: سفارش‌های منتظر بررسی. */
  @Get('orders')
  orders(@Req() request: AdminRequest, @Query('status') status?: string) {
    requireAdmin(request);
    const statuses = status
      ? status.split(',').filter((value): value is SubscriptionOrderStatus => (Object.values(SubscriptionOrderStatus) as string[]).includes(value))
      : [SubscriptionOrderStatus.ReceiptSubmitted];
    return this.access.listOrders(statuses);
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
    const order = await this.access.findOrder(orderId);
    const file = order?.receiptPath ? resolve(order.receiptPath) : null;
    if (!file || !isStoredReceipt(file)) throw new NotFoundException('Receipt image not found');
    this.logger.log(`Admin ${adminUserId} viewed the receipt of broker access order ${orderId}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.sendFile(file, (error) => {
      if (error && !response.headersSent) response.status(404).end();
    });
  }

  @Post('orders/:orderId/approve')
  @HttpCode(200)
  approve(@Req() request: AdminRequest, @Param('orderId', ParseUUIDPipe) orderId: string) {
    const adminUserId = requireAdmin(request)!;
    return this.access.approveOrder(orderId, adminUserId);
  }

  @Post('orders/:orderId/reject')
  @HttpCode(200)
  reject(@Req() request: AdminRequest, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: RejectReceiptDto) {
    const adminUserId = requireAdmin(request)!;
    return this.access.rejectOrder(orderId, adminUserId, dto.reason);
  }
}
