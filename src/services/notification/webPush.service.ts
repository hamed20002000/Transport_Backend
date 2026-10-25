import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import webpush from 'web-push';

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

  /** The same device subscribing again (or for another account on it) replaces its row. */
  async subscribe(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
    await this.subscriptions.upsert(
      { userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      ['endpoint'],
    );
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.delete({ userId, endpoint });
  }

  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    if (!this.enabled) return;
    const rows = await this.subscriptions.find({ where: { userId } });
    await Promise.all(
      rows.map(async (row) => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            JSON.stringify(message),
            { TTL: TTL_SECONDS, timeout: 10_000 },
          );
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await this.subscriptions.delete({ id: row.id });
          else this.logger.warn(`Web push to ${userId} failed: ${status ?? ''} ${(error as Error).message}`);
        }
      }),
    );
  }
}
