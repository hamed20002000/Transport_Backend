import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { BOT_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { IBotLinkRepository } from '../../domain/repositories/messengerBot/IBotLinkRepository';
import { RecordStatus } from '../../domain/enums/RecordStatus';
import { MessengerBotService } from '../messengerBot/core/messengerBot.service';
import { RedisService } from '../redis/redis.service';
import { PaymentReceiptSubmittedEvent, REDIS_CHANNELS, SubscriptionDecidedEvent } from '../redis/redis.keys';
import { NotificationsGateway } from './notifications.gateway';
import { WebPushService } from './webPush.service';
import { WhatsappDialogBridge } from './whatsappDialogBridge';

export const PAYMENT_RECEIPT_SOCKET_EVENT = 'payment-receipt';
export const SUBSCRIPTION_CHANGED_SOCKET_EVENT = 'subscription-changed';

// one notice per event, however many server instances listen on the channel
const NOTICE_ONCE_SECONDS = 60 * 60;
const currencyNames: Record<string, string> = { IRR: 'ریال', IRT: 'تومان' };
const fa = (value: number | string) => Number(value).toLocaleString('fa-IR');
const faDate = (iso: string) => new Date(iso).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });

interface OrderSummary {
  phoneNumber: string;
  amount: string;
  currency: string;
  accountType: string;
  planTitle: string | null;
}

/**
 * Payments must not leave anyone waiting:
 *  - a new receipt (from a bot or the app) reaches every admin at once: phone notification, the receipts page
 *    live, and the admin's own bots and WhatsApp;
 *  - the admin's decision reaches the buyer in the app (phone notification, the subscription page live) and on
 *    WhatsApp. The bots already get it from the admin endpoint.
 * The receipt and admin code sit in modules this one depends on, so they announce over Redis pub/sub.
 */
@Injectable()
export class SubscriptionNotifier implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionNotifier.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly gateway: NotificationsGateway,
    private readonly push: WebPushService,
    private readonly bots: MessengerBotService,
    private readonly whatsapp: WhatsappDialogBridge,
    @Inject(BOT_LINK_REPOSITORY) private readonly botLinks: IBotLinkRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.subscribe(REDIS_CHANNELS.paymentReceiptSubmitted, (message) =>
        void this.handle('receipt', message, (event: PaymentReceiptSubmittedEvent) => this.receiptSubmitted(event)));
      await this.redis.subscribe(REDIS_CHANNELS.subscriptionDecided, (message) =>
        void this.handle('decision', message, (event: SubscriptionDecidedEvent) => this.decided(event)));
    } catch (error) {
      this.logger.warn(`Could not listen for payment events: ${(error as Error).message}`);
    }
  }

  private async handle<T extends { orderId: string }>(kind: string, message: string, send: (event: T) => Promise<void>): Promise<void> {
    try {
      const event = JSON.parse(message) as T;
      const key = RedisService.key('subscriptionNoticeSent', kind, `${event.orderId}:${(event as { receiptId?: string }).receiptId ?? ''}`);
      if (!(await this.redis.setIfAbsent(key, '1', NOTICE_ONCE_SECONDS))) return;
      await send(event);
    } catch (error) {
      this.logger.warn(`Payment ${kind} notice failed: ${(error as Error).message}`);
    }
  }

  async receiptSubmitted(event: PaymentReceiptSubmittedEvent): Promise<void> {
    const order = await this.order(event.orderId);
    if (!order) return;
    const price = `${fa(order.amount)} ${currencyNames[order.currency] ?? order.currency}`;
    const text = `🧾 رسید پرداخت تازه\n${order.planTitle ?? 'اشتراک'} · ${price}\nخریدار: ${order.phoneNumber}\nبرای بررسی به «رسیدهای پرداخت» در پنل ادمین بروید.`;

    this.gateway.sendToRoles(['ADMIN'], PAYMENT_RECEIPT_SOCKET_EVENT, { orderId: event.orderId });
    for (const adminId of await this.adminIds()) {
      await Promise.all([
        this.push.sendToUser(adminId, {
          title: 'ترابوت · رسید پرداخت تازه',
          body: `${order.planTitle ?? 'اشتراک'} · ${price} · ${order.phoneNumber}`,
          url: '/admin/subscription-orders',
          // several receipts in a row: one notification that sounds for each new one
          tag: 'payment-receipts',
          renotify: true,
        }).catch((error: Error) => this.logger.warn(`Receipt push to admin ${adminId} failed: ${error.message}`)),
        this.messengers(adminId, text),
      ]);
    }
  }

  async decided(event: SubscriptionDecidedEvent): Promise<void> {
    const order = await this.order(event.orderId);
    const plan = order?.planTitle ?? 'اشتراک';
    const title = event.approved ? 'اشتراک شما فعال شد ✅' : 'رسید پرداخت شما تأیید نشد';
    const body = event.approved
      ? `${plan}${event.expireAt ? ` تا ${faDate(event.expireAt)}` : ''} فعال است.`
      : `دلیل: ${event.reason ?? '—'}. لطفاً دوباره پرداخت کنید یا رسید درست را بفرستید.`;

    this.gateway.sendToUser(event.userId, SUBSCRIPTION_CHANGED_SOCKET_EVENT, { approved: event.approved });
    await Promise.all([
      this.push.sendToUser(event.userId, {
        title: `ترابوت · ${title}`,
        body,
        url: event.accountType === 'DRIVER' ? '/account/driver/subscription' : '/',
      }).catch((error: Error) => this.logger.warn(`Decision push to ${event.userId} failed: ${error.message}`)),
      // the bots already heard it from the admin endpoint; WhatsApp only from here
      this.whatsapp.notify(event.userId, `${title}\n${body}`)
        .catch((error: Error) => this.logger.warn(`Decision to ${event.userId} on WhatsApp failed: ${error.message}`)),
    ]);
  }

  /** An admin's own linked bots and WhatsApp, like any other notice (messengers behave alike). */
  private async messengers(userId: string, text: string): Promise<void> {
    const links = await this.botLinks.findAllByUserId(userId);
    await Promise.all([
      ...links
        .filter((link) => link.chatId && this.bots.hasPlatform(link.platform))
        .map((link) => this.bots.sendNotification(link.chatId!, text)
          .catch((error: Error) => this.logger.warn(`Receipt notice to admin ${userId} on ${link.platform} failed: ${error.message}`))),
      this.whatsapp.notify(userId, text)
        .catch((error: Error) => this.logger.warn(`Receipt notice to admin ${userId} on WhatsApp failed: ${error.message}`)),
    ]);
  }

  private async adminIds(): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT u.id FROM "User" u
         JOIN "UserRole" ur ON ur."userId" = u.id
         JOIN "Role" r ON r.id = ur."roleId"
        WHERE r.name = 'ADMIN' AND r."recordStatus" = $1 AND u."recordStatus" = $1`,
      [RecordStatus.Active],
    );
    return rows.map((row) => row.id);
  }

  private async order(orderId: string): Promise<OrderSummary | null> {
    const rows: OrderSummary[] = await this.dataSource.query(
      `SELECT o."phoneNumber", o.amount, o.currency, o."accountType", p.title AS "planTitle"
         FROM "SubscriptionOrder" o LEFT JOIN "SubscriptionPlan" p ON p.id = o."subscriptionPlanId"
        WHERE o.id = $1`,
      [orderId],
    );
    return rows[0] ?? null;
  }
}
