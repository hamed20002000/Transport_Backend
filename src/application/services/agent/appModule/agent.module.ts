import { forwardRef, Module } from '@nestjs/common';
import { SubscriptionModule } from 'src/application/module/SubscriptionModule';
import { AgentSqlService } from '../services/agentSql.service';
import { AgentToolsService } from '../services/agentTools.service';
import { ToolRegisterModule } from './toolregister.module';
import { AgentController } from 'src/presentation/controllers/agent/agent.controller';
import { AgentChatController } from 'src/presentation/controllers/agent/agent-chat.controller';
import { AgentGateway } from '../agent.gateway';
import { EmbeddingService } from '../services/embedding.service';
import { CancellationService } from '../services/cancellation.service';
import { FunctionCallService } from '../services/functioncall.service';
import { CondinateService } from '../services/condinate.service';
import { PendingConfirmationService } from '../services/PendingConfirmationService';
import { SpeechToTextService } from '../services/Speechtotext.service';
import { TranscriptCorrectorService } from '../services/transcriptCorrector.service';
import { VoiceCodeResolverService } from '../services/voiceCodeResolver.service';
import { MessengerBotModule } from 'src/application/module/MessengerBotModule';
import { UserService } from 'src/services/UserService';
import { AuthModule } from 'src/auth/auth.module';
import { WhatsappService } from '../services/whatsapp.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { jwtVerifyOnlyOptions } from 'src/auth/jwtKeys';
import { WhatsappModule } from './whatsapp.module';
import { UserModule } from 'src/application/module/UserModule';
import { RedisModule } from 'src/application/module/RedisModule';
import { AgentChannelRelays } from '../agentChannelRelays';
import { BotAgentService } from '../services/botAgent.service';

import { CompanyFeatureModule } from 'src/application/module/CompanyFeatureModule';

@Module({
  imports: [
    ToolRegisterModule,
    forwardRef(() => MessengerBotModule),
    RedisModule,
    // SubscriptionGuard on the chat endpoints
    SubscriptionModule,
    // the assistant is a paid menu for a non-parent company (CompanyFeatureGuard, FunctionCallService)
    CompanyFeatureModule,
      forwardRef(() => AuthModule), 
      forwardRef(() => WhatsappModule), 
      forwardRef(() => UserModule), 
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // فقط بررسی توکن socket -- کلید عمومی RS256
      useFactory: (configService: ConfigService) => jwtVerifyOnlyOptions(configService),
    }),
  ],

  providers: [
    AgentSqlService,
    AgentToolsService,
    AgentGateway,
    EmbeddingService,
    CancellationService,
    FunctionCallService,
    CondinateService,
    PendingConfirmationService,
    SpeechToTextService,
    TranscriptCorrectorService,
    VoiceCodeResolverService,
    AgentChannelRelays,
    BotAgentService,
  ],
  exports: [
    AgentSqlService,
    AgentToolsService,
    AgentGateway,
    CancellationService,
    FunctionCallService,
    CondinateService,
    PendingConfirmationService,
    SpeechToTextService,
    TranscriptCorrectorService,
    VoiceCodeResolverService,
    MessengerBotModule,
  ],

  controllers: [AgentController, AgentChatController],
})
export class AgentModule { }
