import { forwardRef, Module } from '@nestjs/common';
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
import { TelegramModule } from 'src/application/module/TelegramModule';
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
import { TelegramAgentService } from '../services/telegramAgent.service';

@Module({
  imports: [
    ToolRegisterModule,
    TelegramModule,
    RedisModule,
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
    AgentChannelRelays,
    TelegramAgentService,
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
    TelegramModule,
  ],

  controllers: [AgentController, AgentChatController],
})
export class AgentModule { }
