import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { RubikaBotService, RubikaWebhookBody } from './rubikaBot.service';

/**
 * webhook ربات روبیکا. آدرس ثبت‌شده RUBIKA_WEBHOOK_URL/<RUBIKA_WEBHOOK_SECRET>
 * است؛ روبیکا ممکن است نوع آپدیت را هم به انتهای آدرس اضافه کند
 * (receiveUpdate، receiveInlineMessage) -- هر دو شکل پذیرفته می‌شود.
 */
@ApiExcludeController()
@Controller('rubika/webhook')
export class RubikaWebhookController {
  constructor(private readonly rubika: RubikaBotService) {}

  @Post(':secret')
  @HttpCode(200)
  receive(@Param('secret') secret: string, @Body() body: RubikaWebhookBody): { status: string } {
    this.rubika.receiveWebhook(body, secret);
    return { status: 'OK' };
  }

  @Post(':secret/:type')
  @HttpCode(200)
  receiveTyped(@Param('secret') secret: string, @Body() body: RubikaWebhookBody): { status: string } {
    return this.receive(secret, body);
  }
}
