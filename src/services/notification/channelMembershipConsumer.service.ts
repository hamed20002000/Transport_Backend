import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';

import {
  CARGO_EVENTS_EXCHANGE,
  CHANNEL_MEMBERSHIP_CHANGED,
  CHANNEL_MEMBERSHIP_DLQ,
  CHANNEL_MEMBERSHIP_QUEUE,
  CHANNEL_PLATFORMS,
  ChannelMembershipChangedEvent,
  ChannelPlatform,
} from '../../domain/constants/channelEvents';
import { ChannelMembershipNotifier } from './channelMembership.service';

const STATUSES = ['queued', 'pending', 'joined', 'failed', 'removed'];

/**
 * مصرف‌کننده‌ی رویداد تغییر وضعیت عضویت گروه/کانال از tarabari_backend --
 * همان الگوی CargoEventConsumer: payload نامعتبر مستقیم به DLQ، خطای
 * غیرمنتظره یک بار دوباره و بعد DLQ، و ثبت subscriber بدون await.
 */
@Injectable()
export class ChannelMembershipConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChannelMembershipConsumer.name);

  constructor(
    private readonly notifier: ChannelMembershipNotifier,
    private readonly amqp: AmqpConnection,
  ) {}

  onApplicationBootstrap(): void {
    void this.amqp
      .createSubscriber(
        (payload: unknown, message) => this.onMembershipChanged(payload, message),
        {
          exchange: CARGO_EVENTS_EXCHANGE,
          routingKey: CHANNEL_MEMBERSHIP_CHANGED,
          queue: CHANNEL_MEMBERSHIP_QUEUE,
          queueOptions: {
            durable: true,
            deadLetterExchange: '',
            deadLetterRoutingKey: CHANNEL_MEMBERSHIP_DLQ,
          },
        },
        `${ChannelMembershipConsumer.name}.onMembershipChanged`,
      )
      .then(() => this.logger.log(`Consuming ${CHANNEL_MEMBERSHIP_CHANGED} from ${CHANNEL_MEMBERSHIP_QUEUE}`))
      .catch((error: Error) => this.logger.error(`Subscribing to ${CHANNEL_MEMBERSHIP_QUEUE} failed`, error.stack));
  }

  async onMembershipChanged(payload: unknown, message?: { fields: { redelivered: boolean } }): Promise<void | Nack> {
    if (!isChannelMembershipChangedEvent(payload)) {
      this.logger.error(`Invalid ${CHANNEL_MEMBERSHIP_CHANGED} payload, moved to DLQ: ${JSON.stringify(payload)?.slice(0, 500)}`);
      return new Nack(false);
    }

    try {
      await this.notifier.handle(payload);
    } catch (error) {
      const redelivered = message?.fields.redelivered ?? false;
      this.logger.error(
        `Handling membership event ${payload.eventId} failed (${redelivered ? 'moved to DLQ' : 'requeued'})`,
        (error as Error).stack,
      );
      return new Nack(!redelivered);
    }
  }
}

export function isChannelMembershipChangedEvent(value: unknown): value is ChannelMembershipChangedEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ChannelMembershipChangedEvent>;

  return (
    typeof event.eventId === 'string' &&
    typeof event.channelId === 'string' &&
    CHANNEL_PLATFORMS.includes(event.platform as ChannelPlatform) &&
    typeof event.status === 'string' &&
    STATUSES.includes(event.status) &&
    Array.isArray(event.ownerUserIds) &&
    event.ownerUserIds.every((id) => typeof id === 'string')
  );
}
