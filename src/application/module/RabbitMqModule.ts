import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';

import {
  CARGO_EVENTS_EXCHANGE,
  CARGO_NOTIFICATION_DLQ,
} from '../../domain/constants/cargoEvents';

function positiveInt(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),

        // همان تعریف tarabari_backend؛ هر کدام زودتر بالا بیاید exchange را می‌سازد.
        exchanges: [{ name: CARGO_EVENTS_EXCHANGE, type: 'topic' }],

        queues: [{ name: CARGO_NOTIFICATION_DLQ, options: { durable: true } }],

        // مقدارهای .env رشته‌اند؛ amqplib عدد می‌خواهد.
        prefetchCount: positiveInt(configService.get('RABBITMQ_PREFETCH'), 10),

        // اگر RabbitMQ در دسترس نباشد API باید بالا بیاید؛ اتصال در پس‌زمینه
        // دوباره برقرار می‌شود و پیام‌ها در صف durable منتظر می‌مانند.
        // (consumer هم بدون await ثبت می‌شود -- CargoEventConsumer را ببینید.)
        connectionInitOptions: { wait: false },

        connectionManagerOptions: {
          // پیش‌فرض ۵ ثانیه است: اگر پروسه حدود ۱۰ ثانیه جواب ندهد (توقف روی
          // breakpoint، کار سنگین همزمان) RabbitMQ اتصال را بی‌صدا می‌بندد.
          heartbeatIntervalInSeconds: positiveInt(configService.get('RABBITMQ_HEARTBEAT_SECONDS'), 60),
          reconnectTimeInSeconds: 5,
        },
      }),
    }),
  ],
  exports: [RabbitMQModule],
})
export class RabbitMqModule {}
