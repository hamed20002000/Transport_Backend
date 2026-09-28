import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';

import {
  CARGO_EVENTS_EXCHANGE,
  CARGO_MESSAGE_DETECTED,
  CARGO_NOTIFICATION_DLQ,
  CARGO_NOTIFICATION_QUEUE,
  CargoDetectedEvent,
} from '../../domain/constants/cargoEvents';
import { CargoNotificationService } from './cargoNotification.service';

/**
 * مصرف‌کننده‌ی رویداد «بار جدید» از tarabari_backend.
 *
 * - payload نامعتبر: مستقیم به DLQ (تلاش دوباره فایده‌ای ندارد).
 * - خطای غیرمنتظره (مثلاً قطع دیتابیس): یک بار دوباره به صف برمی‌گردد و اگر
 *   باز هم fail شد به DLQ می‌رود، تا صف در یک حلقه‌ی بی‌پایان گیر نکند.
 *
 * عمداً از @RabbitSubscribe استفاده نشده: کتابخانه هنگام bootstrap منتظر
 * می‌ماند تا consumer روی RabbitMQ ثبت شود، و اگر RabbitMQ در دسترس نباشد
 * برنامه هیچ‌وقت به app.listen نمی‌رسد. اینجا ثبت بدون await انجام می‌شود؛
 * API فوراً بالا می‌آید و consumer هر وقت اتصال برقرار شد وصل می‌شود.
 */
@Injectable()
export class CargoEventConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(CargoEventConsumer.name);

  constructor(
    private readonly notifications: CargoNotificationService,
    private readonly amqp: AmqpConnection,
  ) {}

  onApplicationBootstrap(): void {
    void this.amqp
      .createSubscriber(
        (payload: unknown, message) => this.onCargoDetected(payload, message),
        {
          exchange: CARGO_EVENTS_EXCHANGE,
          routingKey: CARGO_MESSAGE_DETECTED,
          queue: CARGO_NOTIFICATION_QUEUE,
          queueOptions: {
            durable: true,
            deadLetterExchange: '',
            deadLetterRoutingKey: CARGO_NOTIFICATION_DLQ,
          },
          // خود handler خطا را می‌گیرد؛ اینجا فقط وقتی می‌رسیم که ack/nack یا
          // خواندن JSON شکست بخورد. handler پیش‌فرض کتابخانه روی کانال بسته
          // (مثلاً قطع اتصال RabbitMQ) nack می‌فرستد، آن هم throw می‌کند و کل
          // پروسه کرش می‌کند. پیام ack نشده بعد از وصل شدن دوباره تحویل داده
          // می‌شود، پس اینجا فقط لاگ کافی است.
          errorHandler: (channel, message, error) => {
            try {
              channel.nack(message, false, false);
              this.logger.error(`Unreadable cargo message moved to DLQ: ${(error as Error)?.message}`);
            } catch {
              this.logger.warn(
                `RabbitMQ channel closed before the cargo message was acknowledged; it will be redelivered ` +
                  `(${(error as Error)?.message})`,
              );
            }
          },
        },
        `${CargoEventConsumer.name}.onCargoDetected`,
      )
      .then(() => this.logger.log(`Consuming ${CARGO_MESSAGE_DETECTED} from ${CARGO_NOTIFICATION_QUEUE}`))
      .catch((error: Error) => this.logger.error(`Subscribing to ${CARGO_NOTIFICATION_QUEUE} failed`, error.stack));
  }

  async onCargoDetected(payload: unknown, message?: { fields: { redelivered: boolean } }): Promise<void | Nack> {
    if (!isCargoDetectedEvent(payload)) {
      this.logger.error(`Invalid ${CARGO_MESSAGE_DETECTED} payload, moved to DLQ: ${JSON.stringify(payload)?.slice(0, 500)}`);
      return new Nack(false);
    }

    try {
      await this.notifications.handleCargoDetected(payload);
    } catch (error) {
      const redelivered = message?.fields.redelivered ?? false;
      this.logger.error(
        `Handling cargo message ${payload.messageId} failed (${redelivered ? 'moved to DLQ' : 'requeued'})`,
        (error as Error).stack,
      );
      return new Nack(!redelivered);
    }
  }
}

export function isCargoDetectedEvent(value: unknown): value is CargoDetectedEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<CargoDetectedEvent>;

  return (
    typeof event.messageId === 'string' &&
    event.messageId.length > 0 &&
    typeof event.rawText === 'string' &&
    Array.isArray(event.ownerUserIds) &&
    event.ownerUserIds.every((id) => typeof id === 'string')
  );
}
