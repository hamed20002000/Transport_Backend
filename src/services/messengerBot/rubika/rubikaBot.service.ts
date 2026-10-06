import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { MultiBot } from '../core/multiBot';
import { RubikaBotClient } from './rubikaBotClient';

const OFFSET_TTL_SECONDS = 30 * 24 * 3600;

export type RubikaWebhookBody = Parameters<RubikaBotClient['handleWebhook']>[0];

/**
 * اتصال ربات روبیکا (botapi.rubika.ir). RubikaBotClient API روبیکا را به شکل
 * TelegramBot درمی‌آورد تا منطق مشترک MessengerBotService روی آن هم کار کند.
 *
 * با RUBIKA_WEBHOOK_URL (+ RUBIKA_WEBHOOK_SECRET) آپدیت‌ها با webhook می‌آیند
 * و دکمه‌ها زیر پیام‌اند؛ بدون آن polling و دکمه‌ها در کیبورد پایین چت.
 */
@Injectable()
export class RubikaBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RubikaBotService.name);
  private client?: RubikaBotClient;
  private webhookSecret?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly multiBot: MultiBot,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    const token = this.config.get<string>('RUBIKA_BOT_TOKEN');
    if (!token) {
      this.logger.warn('RUBIKA_BOT_TOKEN is not configured. Rubika bot is disabled.');
      return;
    }

    const webhookBase = this.config.get<string>('RUBIKA_WEBHOOK_URL');
    this.webhookSecret = this.config.get<string>('RUBIKA_WEBHOOK_SECRET');
    if (webhookBase && !this.webhookSecret) {
      this.logger.error('RUBIKA_WEBHOOK_SECRET is required with RUBIKA_WEBHOOK_URL. Rubika bot is disabled.');
      return;
    }

    // کلید Redis از hash توکن ساخته می‌شود تا خود توکن در Redis نرود.
    const offsetKey = RedisService.key('rubikaPollOffset', createHash('sha256').update(token).digest('hex').slice(0, 16));
    const client = new RubikaBotClient(
      token,
      webhookBase ? `${webhookBase.replace(/\/+$/, '')}/${this.webhookSecret}` : undefined,
      undefined,
      {
        load: () => this.redis.get(offsetKey),
        save: (offsetId) => this.redis.set(offsetKey, offsetId, OFFSET_TTL_SECONDS),
      },
    );
    this.client = client;
    this.multiBot.register('rubika', client);

    void client
      .start()
      .then(() => this.logger.log(`Rubika bot started in ${client.isPolling() ? 'polling' : 'webhook'} mode.`))
      .catch((error: Error) => this.logger.error(`Failed to start Rubika bot: ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isPolling()) await this.client.stopPolling();
  }

  /** webhook روبیکا امضا ندارد؛ راز در خود آدرس است و اینجا بررسی می‌شود. */
  receiveWebhook(body: RubikaWebhookBody, secret: string): void {
    const expected = Buffer.from(this.webhookSecret ?? '');
    const received = Buffer.from(secret ?? '');
    if (!this.client || !expected.length) throw new NotFoundException();
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Invalid Rubika webhook secret.');
    }
    this.client.handleWebhook(body);
  }
}
