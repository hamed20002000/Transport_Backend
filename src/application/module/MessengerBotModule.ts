import { TelegramSubscriptionService } from '../../services/messengerBot/core/telegramSubscription.service';
import { UserModule } from './UserModule';
import { TelegramAccessService } from '../../services/messengerBot/core/telegramAccess.service';
import { RedisModule } from './RedisModule';
import { TelegramKeyboardService } from '../../services/messengerBot/core/telegramKeyboard';
import { TelegramWebhookController } from '../../services/messengerBot/telegram/telegramWebhook.controller';
import { RubikaWebhookController } from '../../services/messengerBot/rubika/rubikaWebhook.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BotLink } from '../../domain/entities/agent/BotLink';

import { BotLinkRepository } from '../../infrastructure/repositories/messengerBot/BotLinkRepository';

import { BOT_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';

import { TelegramSessionService } from 'src/services/messengerBot/core/telegramSession.service';

import { TelegramIdentityService } from 'src/services/messengerBot/core/telegramIdentity.service';

import { TelegramMenuService } from 'src/services/messengerBot/core/telegramMenu.service';

import { TelegramAccountHandler } from 'src/services/messengerBot/core/telegramAccountHandler.service';

import { TelegramMessagesService } from 'src/services/messengerBot/core/telegramMessages.service';

import { MessengerBotService } from 'src/services/messengerBot/core/messengerBot.service';

import { TelegramAgentBridge } from 'src/services/messengerBot/core/telegramAgentBridge';

import { MultiBot } from 'src/services/messengerBot/core/multiBot';

import { TelegramBotService } from 'src/services/messengerBot/telegram/telegramBot.service';

import { BaleBotService } from 'src/services/messengerBot/bale/baleBot.service';

import { RubikaBotService } from 'src/services/messengerBot/rubika/rubikaBot.service';

import { SubscriptionModule } from './SubscriptionModule';
import { ChannelModule } from './ChannelModule';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BotLink,
    ]),

    SubscriptionModule,
    RedisModule,
    UserModule,
    ChannelModule,
  ],

  controllers: [TelegramWebhookController, RubikaWebhookController],

  providers: [
    TelegramSubscriptionService,
    TelegramAccessService,
    TelegramKeyboardService,
    BotLinkRepository,

    {
      provide:
        BOT_LINK_REPOSITORY,

      useExisting:
        BotLinkRepository,
    },

    TelegramSessionService,

    TelegramIdentityService,

    TelegramMessagesService,

    TelegramMenuService,

    TelegramAccountHandler,

    MessengerBotService,

    TelegramAgentBridge,

    // ربات هر پیام‌رسان جدا؛ همه در MultiBot ثبت می‌شوند و منطق MessengerBotService را مشترک دارند.
    MultiBot,

    TelegramBotService,

    BaleBotService,

    RubikaBotService,
  ],

  exports: [
    BOT_LINK_REPOSITORY,

    TelegramIdentityService,

    TelegramMenuService,

    TelegramSessionService,

    TelegramAccountHandler,

    TelegramMessagesService,

    MessengerBotService,

    TelegramAgentBridge,
  ],
})
export class MessengerBotModule {}