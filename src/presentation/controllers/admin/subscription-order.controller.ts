import { Body, Controller, Get, Logger, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { In, Repository } from 'typeorm';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionOrder } from 'src/domain/entities/subscription/SubscriptionOrder';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { AccountProvisioningService } from 'src/services/subscription/accountprovisioning.service';
import { MessengerBotService } from 'src/services/messengerBot/core/messengerBot.service';
import { BotIdentityService } from 'src/services/messengerBot/core/botIdentity.service';
import { requireAdmin } from './subscription-policy.controller';

type AdminRequest = Parameters<typeof requireAdmin>[0];

export class RejectReceiptDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(500)
  reason!: string;
}

/** بررسی رسید خریدهای اشتراک از ربات‌ها و تأیید/رد آن‌ها توسط ادمین. */
@Controller('api/admin/subscription-orders')
@UseGuards(JwtAuthGuard)
export class SubscriptionOrderController {
  private readonly logger = new Logger(SubscriptionOrderController.name);

  constructor(
    @InjectRepository(SubscriptionOrder) private readonly orders: Repository<SubscriptionOrder>,
    private readonly provisioning: AccountProvisioningService,
    private readonly bots: MessengerBotService,
    private readonly identity: BotIdentityService,
  ) {}

  /** پیش‌فرض: سفارش‌هایی که رسیدشان رسیده و منتظر بررسی‌اند. */
  @Get()
  list(@Req() request: AdminRequest, @Query('status') status?: string) {
    requireAdmin(request);
    const statuses = status
      ? status.split(',').filter((value): value is SubscriptionOrderStatus =>
        (Object.values(SubscriptionOrderStatus) as string[]).includes(value))
      : [SubscriptionOrderStatus.ReceiptSubmitted, SubscriptionOrderStatus.UnderReview];
    return this.orders.find({
      where: { status: In(statuses) },
      relations: { subscriptionPlan: true, receipts: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  @Post(':orderId/receipts/:receiptId/approve')
  async approve(
    @Req() request: AdminRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    const adminUserId = requireAdmin(request);
    const result = await this.provisioning.approveOrder(orderId, receiptId, adminUserId!);

    // نقش جدید باید در منوی همه‌ی ربات‌های کاربر دیده شود.
    await this.identity.forgetRoles(result.userId).catch((error: Error) =>
      this.logger.warn(`Could not refresh bot roles for user ${result.userId}: ${error.message}`));

    // اشتراک ثبت شده؛ خطای ارسال پیام نباید تأیید را خراب کند.
    let notified = true;
    try {
      if (result.temporaryPassword) {
        await this.bots.sendAccountCredentials(result.providerUserId, {
          accountType: result.accountType,
          username: result.username,
          temporaryPassword: result.temporaryPassword,
          expireAt: result.expireAt,
        });
      } else {
        await this.bots.sendSubscriptionActivated(result.providerUserId, result.accountType, result.expireAt);
      }
    } catch (error) {
      notified = false;
      this.logger.warn(`Could not notify ${result.providerUserId} about approved order ${orderId}: ${(error as Error).message}`);
    }

    // رمز موقت فقط برای خود کاربر در ربات فرستاده می‌شود، نه در پاسخ ادمین.
    return {
      userId: result.userId,
      username: result.username,
      subscriptionId: result.subscriptionId,
      expireAt: result.expireAt,
      newUser: !!result.temporaryPassword,
      notified,
    };
  }

  @Post(':orderId/receipts/:receiptId/reject')
  async reject(
    @Req() request: AdminRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Body() dto: RejectReceiptDto,
  ) {
    const adminUserId = requireAdmin(request);
    await this.provisioning.rejectReceipt(orderId, receiptId, adminUserId!, dto.reason);
    const order = await this.orders.findOne({ where: { id: orderId } });
    let notified = false;
    if (order) {
      notified = await this.bots.sendSubscriptionRejected(order.providerUserId, dto.reason)
        .then(() => true)
        .catch((error: Error) => {
          this.logger.warn(`Could not notify ${order.providerUserId} about rejected order ${orderId}: ${error.message}`);
          return false;
        });
    }
    return { orderId, notified };
  }
}
