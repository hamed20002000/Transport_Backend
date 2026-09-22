import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from './telegram.service';

@ApiExcludeController()
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Body() update: TelegramBot.Update,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<void> {
    await this.telegram.receiveWebhook(update, secret);
  }
}
