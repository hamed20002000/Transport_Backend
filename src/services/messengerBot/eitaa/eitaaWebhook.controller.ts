import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { EitaaBotService } from './eitaaBot.service';

/** GoOmni's webhook for the Eitaa account; signed over the raw body (main.ts keeps it with rawBody: true). */
@ApiExcludeController()
@Controller('eitaa/webhook')
export class EitaaWebhookController {
  constructor(private readonly eitaa: EitaaBotService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-goomni-event-id') eventId: string | undefined,
  ): Promise<{ status: string }> {
    await this.eitaa.receiveWebhook(request.rawBody, signature, eventId);
    return { status: 'OK' };
  }
}
