import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from '../services/WhatsappService';
import { WhatsappAuthCredential } from '../entities/WhatsappAuthCredential';
import { WhatsappAuthKey } from '../entities/WhatsappAuthKey';
import { WhatsappUserMapping } from '../entities/WhatsappUserMapping';
// این importو با ماژولی که AgentGateway/FunctionCallService رو export می‌کنه جایگزین کنید
import { AgentModule } from './agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WhatsappAuthCredential,
      WhatsappAuthKey,
      WhatsappUserMapping,
    ]),
    // forwardRef چون AgentGateway هم برعکس به WhatsappService نیاز داره
    forwardRef(() => AgentModule),
  ],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}