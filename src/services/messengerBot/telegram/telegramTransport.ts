import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import TelegramBot from 'node-telegram-bot-api';

export class TelegramTransport {
  readonly mode: 'polling' | 'webhook';
  private readonly url?: string;
  private readonly secret?: string;

  constructor(config: ConfigService) {
    const mode = config.get<string>('TELEGRAM_BOT_MODE', 'polling');
    if (mode !== 'polling' && mode !== 'webhook') {
      throw new Error('TELEGRAM_BOT_MODE must be polling or webhook.');
    }
    this.mode = mode;
    if (mode === 'webhook') {
      this.url = config.get<string>('TELEGRAM_WEBHOOK_URL');
      this.secret = config.get<string>('TELEGRAM_WEBHOOK_SECRET');
      let url: URL;
      try {
        url = new URL(this.url ?? '');
      } catch {
        throw new Error('TELEGRAM_WEBHOOK_URL must be a public HTTPS URL.');
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
        throw new Error('TELEGRAM_WEBHOOK_URL must be an HTTPS URL without credentials, query or fragment.');
      }
      if (!this.secret || !/^[A-Za-z0-9_-]{1,256}$/.test(this.secret)) {
        throw new Error('TELEGRAM_WEBHOOK_SECRET must contain 1-256 letters, digits, underscores or hyphens.');
      }
    }
  }

  async start(bot: TelegramBot): Promise<void> {
    if (this.mode === 'webhook') {
      await bot.setWebHook(this.url!, {
        secret_token: this.secret,
        max_connections: 1,
        allowed_updates: ['message', 'callback_query'],
      });
    } else {
      // Switching back from webhook must preserve pending updates.
      await bot.deleteWebHook();
      await bot.startPolling();
    }
  }

  authorize(secret: string | undefined): void {
    if (this.mode !== 'webhook') throw new NotFoundException();
    const expected = Buffer.from(this.secret!);
    const received = Buffer.from(secret ?? '');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Invalid Telegram webhook secret.');
    }
  }
}
