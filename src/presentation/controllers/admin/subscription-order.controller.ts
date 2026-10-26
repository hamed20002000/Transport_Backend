import { resolve } from 'path';
import { Body, Controller, Get, Headers, HttpCode, Inject, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { In, Repository } from 'typeorm';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionOrder } from 'src/domain/entities/subscription/SubscriptionOrder';
import { PaymentReceipt } from 'src/domain/entities/subscription/PaymentReceipt';
import { BOT_LINK_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { IBotLinkRepository } from 'src/domain/repositories/messengerBot/IBotLinkRepository';
import { CommunicationProvider, SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { AccountProvisioningService } from 'src/services/subscription/accountprovisioning.service';
import { MessengerBotService } from 'src/services/messengerBot/core/messengerBot.service';
import { BotIdentityService } from 'src/services/messengerBot/core/botIdentity.service';
import { requireAdmin } from './subscription-policy.controller';
import { ReceiptAccessService } from 'src/services/subscription/receiptAccess.service';
import { SubscriptionRewardService } from 'src/services/subscription/subscriptionReward.service';
import { isStoredReceipt } from 'src/services/subscription/receiptStorage';
import { RedisService } from 'src/services/redis/redis.service';
import { REDIS_CHANNELS, SubscriptionDecidedEvent } from 'src/services/redis/redis.keys';

type AdminRequest = Parameters<typeof requireAdmin>[0];

export class UnlockReceiptsDto {
  @IsString() @MinLength(1) @MaxLength(200)
  password!: string;
}

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
    @InjectRepository(PaymentReceipt) private readonly receipts: Repository<PaymentReceipt>,
    @Inject(BOT_LINK_REPOSITORY) private readonly botLinks: IBotLinkRepository,
    private readonly receiptAccess: ReceiptAccessService,
    private readonly redis: RedisService,
    private readonly provisioning: AccountProvisioningService,
    private readonly bots: MessengerBotService,
    private readonly identity: BotIdentityService,
    private readonly rewards: SubscriptionRewardService,
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

  /** The receipts password (ReceiptAccessService): a short-lived token for this admin to see the photos. */
  @Post('receipts/unlock')
  @HttpCode(200)
  unlock(@Req() request: AdminRequest, @Body() dto: UnlockReceiptsDto) {
    return this.receiptAccess.unlock(requireAdmin(request)!, dto.password);
  }

  /**
   * The receipt photo: an admin who has also entered the receipts password (X-Receipt-Token). Only files in
   * the private receipt store are served, never cached by a shared cache, and every view is logged.
   */
  @Get(':orderId/receipts/:receiptId/image')
  async image(
    @Req() request: AdminRequest,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Headers('x-receipt-token') token: string | undefined,
    @Res() response: Response,
  ) {
    const adminUserId = requireAdmin(request)!;
    await this.receiptAccess.assertUnlocked(adminUserId, token);
    const receipt = await this.receipts.findOne({ where: { id: receiptId, orderId } });
    const file = receipt?.imageUrl ? resolve(receipt.imageUrl) : null;
    if (!file || !isStoredReceipt(file)) throw new NotFoundException('Receipt image not found');
    this.logger.log(`Admin ${adminUserId} viewed receipt ${receiptId} of order ${orderId}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.sendFile(file, (error) => {
      if (error && !response.headersSent) response.status(404).end();
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
    for (const target of await this.notifyTargets(orderId, result.providerUserId)) {
      try {
        if (result.newUser) {
          await this.bots.sendAccountCredentials(target, {
            accountType: result.accountType,
            username: result.username,
            expireAt: result.expireAt,
          });
        } else {
          await this.bots.sendSubscriptionActivated(target, result.accountType, result.expireAt);
        }
      } catch (error) {
        notified = false;
        this.logger.warn(`Could not notify ${target} about approved order ${orderId}: ${(error as Error).message}`);
      }
    }

    // this payment may take the driver past a reward tier: the free days are given now and announced with it
    const bonuses = await this.rewards.grantEarned(result.userId).catch((error: Error) => {
      this.logger.warn(`Could not check purchase rewards for ${result.userId}: ${error.message}`);
      return [];
    });
    await this.announceDecision({
      orderId,
      userId: result.userId,
      approved: true,
      accountType: result.accountType,
      expireAt: result.expireAt.toISOString(),
      ...(bonuses.length && {
        bonusDays: bonuses.reduce((sum, bonus) => sum + bonus.days, 0),
        bonusUntil: bonuses[bonuses.length - 1].expireAt.toISOString(),
      }),
    });

    return {
      userId: result.userId,
      username: result.username,
      subscriptionId: result.subscriptionId,
      expireAt: result.expireAt,
      newUser: result.newUser,
      notified,
      rewardDays: bonuses.reduce((sum, bonus) => sum + bonus.days, 0),
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
      for (const target of await this.notifyTargets(orderId, order.providerUserId)) {
        notified = (await this.bots.sendSubscriptionRejected(target, dto.reason)
          .then(() => true)
          .catch((error: Error) => {
            this.logger.warn(`Could not notify ${target} about rejected order ${orderId}: ${error.message}`);
            return false;
          })) || notified;
      }
    }
    const userId = order ? await this.buyerUserId(order) : null;
    if (order && userId) {
      await this.announceDecision({ orderId, userId, approved: false, accountType: order.accountType, reason: dto.reason });
    }
    return { orderId, notified };
  }

  /** The buyer's account: the user for an order from the app, the linked account for one from a bot. */
  private async buyerUserId(order: SubscriptionOrder): Promise<string | null> {
    if (order.provider === CommunicationProvider.Web) return order.providerUserId;
    return (await this.botLinks.findByExternalUserId(order.providerUserId))?.userId ?? order.createdUserId ?? null;
  }

  /** The app (push, live page) and WhatsApp hear the result through SubscriptionNotifier; a failure is only logged. */
  private async announceDecision(event: SubscriptionDecidedEvent): Promise<void> {
    await this.redis
      .publish(REDIS_CHANNELS.subscriptionDecided, JSON.stringify(event))
      .catch((error: Error) => this.logger.warn(`Could not announce the decision on order ${event.orderId}: ${error.message}`));
  }

  /**
   * Who hears about the decision: a bot order goes back to the bot it came from; an order from the app
   * (providerUserId = the user) to every bot the user has linked. The app itself shows the result on the
   * subscription page.
   */
  private async notifyTargets(orderId: string, providerUserId: string): Promise<string[]> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (order?.provider !== CommunicationProvider.Web) return [providerUserId];
    return (await this.botLinks.findAllByUserId(providerUserId)).map((link) => link.externalUserId);
  }
}
