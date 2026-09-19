import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from '../services/whatsapp.service';
import { WhatsappAuthCredential } from 'src/domain/entities/agent/WhatsappAuthCredential';
import { WhatsappAuthKey } from 'src/domain/entities/agent/WhatsappAuthKey';
import { WhatsappUserMapping } from 'src/domain/entities/agent/WhatsappUserMapping';
// این importو با ماژولی که AgentGateway/FunctionCallService رو export می‌کنه جایگزین کنید
import { AgentModule } from './agent.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WhatsappAuthCredential,
      WhatsappAuthKey,
      WhatsappUserMapping,
    ]),
    // forwardRef چون AgentGateway هم برعکس به WhatsappService نیاز داره
    forwardRef(() => AgentModule),
    AuthModule
  ],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}