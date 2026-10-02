import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { MultiBot } from '../core/multiBot';

/**
 * اتصال ربات بله. API ربات بله همان API ربات تلگرام است (فقط آدرسش فرق
 * دارد)، پس همان کتابخانه با baseApiUrl بله استفاده می‌شود. منطق ربات در
 * MessengerBotService مشترک است.
 */
@Injectable()
export class BaleBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaleBotService.name);
  private bot?: TelegramBot;

  constructor(
    private readonly config: ConfigService,
    private readonly multiBot: MultiBot,
  ) {}

  onModuleInit(): void {
    const token = this.config.get<string>('BALE_BOT_TOKEN');
    if (!token) {
      this.logger.warn('BALE_BOT_TOKEN is not configured. Bale bot is disabled.');
      return;
    }

    const bot = new TelegramBot(token, {
      polling: false,
      baseApiUrl: this.config.get<string>('BALE_BOT_API_URL', 'https://tapi.bale.ai'),
    });
    this.bot = bot;
    this.multiBot.register('bale', bot);

    void bot
      .startPolling()
      .then(() => this.logger.log('Bale bot started in polling mode.'))
      .catch((error: Error) => this.logger.error(`Failed to start Bale bot: ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot?.isPolling()) await this.bot.stopPolling();
  }
}
