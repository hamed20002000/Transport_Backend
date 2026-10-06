import { BotSubscriptionService } from '../../services/messengerBot/core/botSubscription.service';
import { UserModule } from './UserModule';
import { BotAccessService } from '../../services/messengerBot/core/botAccess.service';
import { RedisModule } from './RedisModule';
import { BotKeyboardService } from '../../services/messengerBot/core/botKeyboard';
import { BotDialogRegistry } from '../../services/messengerBot/core/botDialog';
import { TelegramWebhookController } from '../../services/messengerBot/telegram/telegramWebhook.controller';
import { RubikaWebhookController } from '../../services/messengerBot/rubika/rubikaWebhook.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BotLink } from '../../domain/entities/agent/BotLink';

import { BotLinkRepository } from '../../infrastructure/repositories/messengerBot/BotLinkRepository';

import { BOT_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';

import { BotSessionService } from 'src/services/messengerBot/core/botSession.service';

import { BotIdentityService } from 'src/services/messengerBot/core/botIdentity.service';

import { BotMenuService } from 'src/services/messengerBot/core/botMenu.service';

import { BotAccountHandler } from 'src/services/messengerBot/core/botAccountHandler.service';

import { BotMessagesService } from 'src/services/messengerBot/core/botMessages.service';

import { MessengerBotService } from 'src/services/messengerBot/core/messengerBot.service';

import { BotAgentBridge } from 'src/services/messengerBot/core/botAgentBridge';

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
    BotSubscriptionService,
    BotAccessService,
    BotKeyboardService,
    BotDialogRegistry,
    BotLinkRepository,

    {
      provide:
        BOT_LINK_REPOSITORY,

      useExisting:
        BotLinkRepository,
    },

    BotSessionService,

    BotIdentityService,

    BotMessagesService,

    BotMenuService,

    BotAccountHandler,

    MessengerBotService,

    BotAgentBridge,

    // ربات هر پیام‌رسان جدا؛ همه در MultiBot ثبت می‌شوند و منطق MessengerBotService را مشترک دارند.
    MultiBot,

    TelegramBotService,

    BaleBotService,

    RubikaBotService,
  ],

  exports: [
    BOT_LINK_REPOSITORY,

    BotIdentityService,

    BotMenuService,

    BotSessionService,

    BotAccountHandler,

    BotMessagesService,

    MessengerBotService,

    BotAgentBridge,

    BotDialogRegistry,
  ],
})
export class MessengerBotModule {}