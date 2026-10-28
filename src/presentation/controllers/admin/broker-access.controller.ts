import { resolve } from 'path';
import { Body, Controller, Get, Headers, HttpCode, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { BrokerAccessService } from 'src/services/company/brokerAccess.service';
import { ReceiptAccessService } from 'src/services/subscription/receiptAccess.service';
import { isStoredReceipt } from 'src/services/subscription/receiptStorage';
import { requireAdmin } from './subscription-policy.controller';
import { RejectReceiptDto } from './subscription-order.controller';

type AdminRequest = Parameters<typeof requireAdmin>[0];

export class UpdateBrokerAccessPolicyDto {
  /** خاموش = واسط بار همه‌ی شرکت‌ها را بی‌خرید می‌بیند. */
  @IsBoolean()
  enabled!: boolean;

  /** شرکت‌هایی که basePrice می‌پوشاند. */
  @IsInt() @Min(1) @Max(1000)
  includedCompanies!: number;

  // A decimal string keeps bigint amounts exact across JSON and JavaScript.
  @IsString() @Matches(/^(0|[1-9][0-9]{0,17})$/)
  basePrice!: string;

  /** هر شرکت بیشتر از includedCompanies */
  @IsString() @Matches(/^(0|[1-9][0-9]{0,17})$/)
  extraCompanyPrice!: string;

  @IsInt() @Min(1) @Max(3650)
  durationDays!: number;

  @IsIn(['IRR', 'GBP', 'EUR', 'SAR', 'CNY'])
  currency: string = 'IRR';
}

export class GrantBrokerAccessDto {
  /** NEW: a period of days after any open one; ADD: companies added to the open period */
  @IsIn(['NEW', 'ADD'])
  kind!: 'NEW' | 'ADD';

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true })
  companyUserIds!: string[];

  @IsInt() @Min(1) @Max(3650)
  days: number = 30;
}

/** قیمت و روشن/خاموش بودن خرید واسط، بررسی فیش‌ها و دسترسی بی‌خرید (هدیه) برای یک واسط. */
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
    return this.access.setPolicy({ ...dto }, adminUserId);
  }

  @Get('brokers')
  brokers(@Req() request: AdminRequest) {
    requireAdmin(request);
    return this.access.listBrokers();
  }

  /** دوره و شرکت‌های یک واسط و شرکت‌های قابل انتخاب، همان که خودش در صفحه‌ی خرید می‌بیند. */
  @Get('brokers/:userId')
  brokerStatus(@Req() request: AdminRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    requireAdmin(request);
    return this.access.status(userId);
  }

  @Post('brokers/:userId/grants')
  grant(@Req() request: AdminRequest, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: GrantBrokerAccessDto) {
    const adminUserId = requireAdmin(request)!;
    return this.access.grant(userId, dto, adminUserId);
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
