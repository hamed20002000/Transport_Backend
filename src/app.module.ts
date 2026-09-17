import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModule } from './application/services/user/appModuls/user.module';
import { AuthModule } from './auth/auth.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { MulterModule } from '@nestjs/platform-express';
import { fileUploadOptions } from './interceptors/file-option';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import { NotificationsModule } from './application/services/notificatin/notifications.module';
import { OllamaAssistantService } from './agent/ollama-assistant.service';
import { AgentAssistantController } from './presentation/controllers/admin/agent-assistant.controller';
import { ToolRegisterModule } from './application/services/agent/appModule/toolregister.module';
import { ContextManagerModule } from './application/services/agent/appModule/contextManager.module';
import { ConversationSession } from './application/services/agent/entities/ConversationSession';
import { PromptSubmission } from './application/services/agent/entities/PromptSubmission';
import { ToolExecution } from './application/services/agent/entities/ToolExecution';
import { TelegramLink } from './application/services/agent/entities/TelegramLink';
import { TelegramLinkCode } from './application/services/agent/entities/TelegramLinkCode';
import { WhatsappModule } from './application/services/agent/appModule/whatsapp.module';
import { WhatsappAuthCredential } from './application/services/agent/entities/WhatsappAuthCredential';
import { WhatsappAuthKey } from './application/services/agent/entities/WhatsappAuthKey';
import { WhatsappUserMapping } from './application/services/agent/entities/WhatsappUserMapping';

@Module({
  imports: [
    ServeStaticModule.forRoot({
     rootPath: path.join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',    },
      {
    rootPath: path.join(__dirname, '..', 'cdn'),
    serveRoot: '/cdn',
  }),
    MulterModule.registerAsync({
      useFactory: () => fileUploadOptions,
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
    ConfigModule.forRoot({ isGlobal: true, // Makes the config available globally 
    envFilePath: '.env', // Specify the path to the .env file in the dist folder 
   
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      /* useFactory: typeOrmConfig, */
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', '123qwe$%'),
        database: configService.get<string>('DB_DATABASE', 'SetasportalDb'),
      /*   entities: ['domain/entities/*.ts'], */
       entities: [ConversationSession,PromptSubmission,ToolExecution,TelegramLink,
        TelegramLinkCode,WhatsappAuthCredential,WhatsappAuthKey,WhatsappUserMapping
       ],
        migrations: ['domain/migrations/*.ts'],
          migrationsRun: false,   
         synchronize: false, // Disable auto schema synchronization
        logging: true, // ['error'], // Log only errors
        logger: 'advanced-console',
    }),
    }),
    /* ConfigModule.forRoot({ load: [typeormConfig] }), */
    ConfigModule.forRoot({
     
      isGlobal: true,  // Makes the config available globally
    }),
    AuthModule,
    UserModule,
    NotificationsModule,
    ToolRegisterModule,
    ContextManagerModule,
    WhatsappModule
  ],
  controllers: [AgentAssistantController],
  providers: [OllamaAssistantService],
})
export class AppModule {}
