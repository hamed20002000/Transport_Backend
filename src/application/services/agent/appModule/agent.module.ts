import { forwardRef, Module } from '@nestjs/common';
import { AgentSqlService } from '../services/agentSql.service';
import { AgentToolsService } from '../services/agentTools.service';
import { ToolRegisterModule } from './toolregister.module';
import { AgentController } from 'src/presentation/controllers/agent/agent.controller';
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
import { JwtService } from '@nestjs/jwt';
import { WhatsappModule } from './whatsapp.module';
import { UserModule } from 'src/application/module/UserModule';

@Module({
  imports: [
    ToolRegisterModule,
    TelegramModule,
      forwardRef(() => AuthModule), 
      forwardRef(() => WhatsappModule), 
      forwardRef(() => UserModule), 
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
    JwtService,
    FunctionCallService
    
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
     JwtService,
    FunctionCallService
   
  ],

  controllers: [AgentController],
})
export class AgentModule { }
