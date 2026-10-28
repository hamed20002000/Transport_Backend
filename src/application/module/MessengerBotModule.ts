import { BotSubscriptionService } from '../../services/messengerBot/core/botSubscription.service';
import { UserModule } from './UserModule';
import { BotAccessService } from '../../services/messengerBot/core/botAccess.service';
import { RedisModule } from './RedisModule';
import { BotKeyboardService } from '../../services/messengerBot/core/botKeyboard';
import { BotDialogRegistry } from '../../services/messengerBot/core/botDialog';
import { TelegramWebhookController } from '../../services/messengerBot/telegram/telegramWebhook.controller';
import { RubikaWebhookController } from '../../services/messengerBot/rubika/rubikaWebhook.controller';
import { EitaaWebhookController } from '../../services/messengerBot/eitaa/eitaaWebhook.controller';
import { EitaaBotService } from 'src/services/messengerBot/eitaa/eitaaBot.service';
import { MessengerLinkCodeService } from 'src/services/messengerBot/core/messengerLinkCode.service';
import { EitaaLinkController } from 'src/presentation/controllers/messenger/eitaaLink.controller';
import { forwardRef, Module } from '@nestjs/common';
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
import { FactoryInviteBridge } from 'src/services/messengerBot/core/factoryInvite';

import { MultiBot } from 'src/services/messengerBot/core/multiBot';

import { TelegramBotService } from 'src/services/messengerBot/telegram/telegramBot.service';

import { BaleBotService } from 'src/services/messengerBot/bale/baleBot.service';

import { RubikaBotService } from 'src/services/messengerBot/rubika/rubikaBot.service';

import { SubscriptionModule } from './SubscriptionModule';
import { CompanyFeatureModule } from './CompanyFeatureModule';
import { ChannelModule } from './ChannelModule';
import { MarketModule } from './MarketModule';
import { MarketBotService } from 'src/services/market/marketBot.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BotLink,
    ]),

    SubscriptionModule,
    CompanyFeatureModule,
    RedisModule,
    UserModule,
    forwardRef(() => ChannelModule),
    MarketModule,
  ],

  controllers: [TelegramWebhookController, RubikaWebhookController, EitaaWebhookController, EitaaLinkController],

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
    FactoryInviteBridge,

    // ربات هر پیام‌رسان جدا؛ همه در MultiBot ثبت می‌شوند و منطق MessengerBotService را مشترک دارند.
    MultiBot,

    TelegramBotService,

    BaleBotService,

    RubikaBotService,
    EitaaBotService,
    MessengerLinkCodeService,
    // پیام قیمت ارز و طلا که هر ۳۰ دقیقه ویرایش می‌شود
    MarketBotService,
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
    FactoryInviteBridge,

    BotDialogRegistry,
  ],
})
export class MessengerBotModule {}
