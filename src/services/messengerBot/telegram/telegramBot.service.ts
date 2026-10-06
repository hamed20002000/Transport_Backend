import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { MessengerBotService } from '../core/messengerBot.service';
import { MultiBot } from '../core/multiBot';
import { TelegramTransport } from './telegramTransport';

const RETRY_DELAY_MS = 30_000;

/**
 * اتصال ربات تلگرام (polling یا webhook). منطق ربات در MessengerBotService
 * مشترک است؛ این سرویس فقط کلاینت تلگرام را می‌سازد و در MultiBot ثبت می‌کند.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot?: TelegramBot;
  private transport?: TelegramTransport;
  private ready = false;
  private destroyed = false;
  private retryTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly multiBot: MultiBot,
    private readonly messenger: MessengerBotService,
  ) {}

  onModuleInit(): void {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not configured. Telegram bot is disabled.');
      return;
    }

    this.transport = new TelegramTransport(this.config);
    const bot = new TelegramBot(token, { polling: false });
    this.bot = bot;
    this.multiBot.register('telegram', bot);

    // در پس‌زمینه: تلگرامِ فیلترشده ممکن است دقیقه‌ها جواب ندهد و نباید
    // بالا آمدن برنامه یا بقیه‌ی ربات‌ها را معطل کند.
    this.start(bot, this.transport);
  }

  /** تا وقتی تلگرام در دسترس نیست (فیلتر/قطعی VPN) دوباره تلاش می‌کند؛ بعد از شروع، خود polling خطاها را تحمل می‌کند. */
  private start(bot: TelegramBot, transport: TelegramTransport): void {
    void transport
      .start(bot)
      .then(() => {
        this.ready = true;
        this.logger.log(`Telegram bot started in ${transport.mode} mode.`);
      })
      .catch((error: Error) => {
        if (this.destroyed) return;
        this.logger.error(`Failed to start Telegram bot: ${error.message}. Retrying in ${RETRY_DELAY_MS / 1000}s.`);
        this.retryTimer = setTimeout(() => this.start(bot, transport), RETRY_DELAY_MS);
      });
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    clearTimeout(this.retryTimer);
    this.ready = false;
    if (this.bot?.isPolling()) await this.bot.stopPolling();
    // Keep the remote webhook registered across deployments.
  }

  async receiveWebhook(update: TelegramBot.Update, secret?: string): Promise<void> {
    if (!this.transport) throw new ServiceUnavailableException('Telegram bot is disabled.');
    this.transport.authorize(secret);
    if (!this.ready) throw new ServiceUnavailableException('Telegram bot is not ready.');
    if (!update || !Number.isSafeInteger(update.update_id) || update.update_id < 0) {
      throw new BadRequestException('Invalid Telegram update.');
    }
    // Await the handlers so failures reach Telegram as a non-2xx response.
    await this.messenger.handleUpdate(update);
  }
}
