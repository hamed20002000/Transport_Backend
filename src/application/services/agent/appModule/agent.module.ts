import { Module } from '@nestjs/common';
import { AgentSqlService } from '../services/agentSql.service';
import { AgentToolsService } from '../services/agentTools.service';
import { ToolRegisterModule } from './toolregister.module';
import { AgentController } from 'src/presentation/controllers/agent/agent.controller';
import { AgentGateway } from '../agent.gateway';
import { EmbeddingService } from '../services/embedding.service';
import { CancellationService } from '../services/cancellation.service';
import { FunctionCallService } from '../services/functioncall.service';
import { CondinateService } from '../services/condinate.service';

@Module({
  imports: [
    ToolRegisterModule,
  ],

  providers: [
    AgentSqlService,
    AgentToolsService,
    AgentGateway,
    EmbeddingService,
    CancellationService,
    FunctionCallService,
    CondinateService
  ],
  exports: [
    AgentSqlService,
    AgentToolsService,
    AgentGateway,
    CancellationService,
    FunctionCallService,
    CondinateService
  ],

  controllers: [AgentController],
})
export class AgentModule { }