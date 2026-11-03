import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import webpush from 'web-push';
import { proxyUrl } from '../common/outboundProxy';

import { WebPushSubscription } from '../../domain/entities/notification/WebPushSubscription';

export interface PushMessage {
  title: string;
  body: string;
  /** page of the app the notification opens */
  url: string;
  /** a later notification with the same tag replaces this one on the phone instead of piling up */
  tag?: string;
  /** with a tag: whether the replacement sounds/vibrates again (false = silent update) */
  renotify?: boolean;
}

// a notification nobody sees within a day is not worth showing late
const TTL_SECONDS = 24 * 60 * 60;
// sends at once to the push services, through the one VPN proxy
const PUSH_CONCURRENCY = 50;

/**
 * Phone notifications of the installed app (Web Push, VAPID). Without VAPID keys it does nothing. A subscription
 * the push service says is gone (404/410: app removed, permission revoked) is deleted.
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  readonly publicKey: string | null;

  constructor(
    @InjectRepository(WebPushSubscription) private readonly subscriptions: Repository<WebPushSubscription>,
    config: ConfigService,
  ) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY');
    // the push services' contact for us: our own mailto: or https: address (Apple refuses one that is missing or fake)
    const subject = config.get<string>('VAPID_SUBJECT')?.trim();
    this.publicKey = publicKey && privateKey && subject ? publicKey : null;
    if (publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } else if (publicKey && privateKey) {
      this.logger.warn('VAPID_SUBJECT is not set: phone notifications are off.');
    }
  }

  get enabled(): boolean {
    return this.publicKey !== null;
  }

  /**
   * A device never moves to another account quietly: an account made later on the same phone (e.g. for someone who
   * cannot sign up themselves) would otherwise take it, and its notifications would go to the phone's owner. Only an
   * explicit takeOver (the holder confirmed in the profile that the phone is theirs) moves it. False when the device
   * belongs to another account; the same account subscribing again refreshes its keys.
   */
  async subscribe(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    takeOver = false,
  ): Promise<boolean> {
    const existing = await this.subscriptions.findOne({ where: { endpoint: subscription.endpoint } });
    if (existing && existing.userId !== userId && !takeOver) return false;
    await this.subscriptions.upsert(
      { userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      ['endpoint'],
    );
    return true;
  }

  /** The account whose notifications this device gets, if any. */
  async ownerOf(endpoint: string): Promise<string | null> {
    const row = await this.subscriptions.findOne({ where: { endpoint } });
    return row?.userId ?? null;
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.delete({ userId, endpoint });
  }

  /** exceptEndpoint: a device of the account that is not to get this one (the one it is about) */
  async sendToUser(userId: string, message: PushMessage, exceptEndpoint?: string): Promise<void> {
    if (!this.enabled) return;
    const rows = (await this.subscriptions.find({ where: { userId } })).filter((row) => row.endpoint !== exceptEndpoint);
    await Promise.all(rows.map((row) => this.deliver(row, message)));
  }

  /**
   * A notification to each of many users (a load announced to thousands of drivers): their devices read a thousand
   * users at a time, and at most PUSH_CONCURRENCY sends at once, so neither the proxy nor the database is flooded.
   */
  /** The users reached (on one device at least). */
  async sendToMany(messages: Map<string, PushMessage>): Promise<number> {
    if (!this.enabled || !messages.size) return 0;
    const reached = new Set<string>();
    const userIds = [...messages.keys()];
    for (let start = 0; start < userIds.length; start += 1000) {
      const rows = await this.subscriptions.find({ where: { userId: In(userIds.slice(start, start + 1000)) } });
      let next = 0;
      const worker = async () => {
        while (next < rows.length) {
          const row = rows[next++];
          if (await this.deliver(row, messages.get(row.userId)!)) reached.add(row.userId);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, rows.length) }, worker));
    }
    return reached.size;
  }

  private async deliver(row: WebPushSubscription, message: PushMessage): Promise<boolean> {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(message),
        // the push services (FCM, Mozilla, Apple) are abroad: on the server through the VPN proxy
        // (web-push takes only its own https.Agent, so the proxy goes by its address)
        { TTL: TTL_SECONDS, timeout: 10_000, ...(proxyUrl() && { proxy: proxyUrl()! }) },
      );
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await this.subscriptions.delete({ id: row.id });
      else this.logger.warn(`Web push to ${row.userId} failed: ${status ?? ''} ${(error as Error).message}`);
      return false;
    }
  }
}
