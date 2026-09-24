import { TelegramSubscriptionService } from '../../services/telegram/telegramSubscription.service';
import { UserModule } from './UserModule';
import { TelegramAccessService } from '../../services/telegram/telegramAccess.service';
import { RedisModule } from './RedisModule';
import { TelegramKeyboardService } from '../../services/telegram/telegramKeyboard';
import { TelegramWebhookController } from '../../services/telegram/telegramWebhook.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TelegramLink } from '../../domain/entities/agent/TelegramLink';

import { TelegramLinkRepository } from '../../infrastructure/repositories/telegram/TelegramLinkRepository';

import { TELEGRAM_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';

import { TelegramSessionService } from 'src/services/telegram/telegramSession.service';

import { TelegramIdentityService } from 'src/services/telegram/telegramIdentity.service';

import { TelegramMenuService } from 'src/services/telegram/telegramMenu.service';

import { TelegramAccountHandler } from 'src/services/telegram/telegramAccountHandler.service';

import { TelegramMessagesService } from 'src/services/telegram/telegramMessages.service';

import { TelegramService } from 'src/services/telegram/telegram.service';

import { SubscriptionModule } from './SubscriptionModule';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TelegramLink,
    ]),

    SubscriptionModule,
    RedisModule,
    UserModule,
  ],

  controllers: [TelegramWebhookController],

  providers: [
    TelegramSubscriptionService,
    TelegramAccessService,
    TelegramKeyboardService,
    TelegramLinkRepository,

    {
      provide:
        TELEGRAM_LINK_REPOSITORY,

      useExisting:
        TelegramLinkRepository,
    },

    TelegramSessionService,

    TelegramIdentityService,

    TelegramMessagesService,

    TelegramMenuService,

    TelegramAccountHandler,

    TelegramService,
  ],

  exports: [
    TelegramIdentityService,

    TelegramMenuService,

    TelegramSessionService,

    TelegramAccountHandler,

    TelegramMessagesService,

    TelegramService,
  ],
})
export class TelegramModule {}