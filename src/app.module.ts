import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { MulterModule } from '@nestjs/platform-express';
import { fileUploadOptions } from './interceptors/file-option';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import { OllamaAssistantService } from './agent/ollama-assistant.service';
import { ToolRegisterModule } from './application/services/agent/appModule/toolregister.module';
import { ContextManagerModule } from './application/services/agent/appModule/contextManager.module';
import { ConversationSession } from './domain/entities/agent/ConversationSession';
import { PromptSubmission } from './domain/entities/agent/PromptSubmission';
import { ToolExecution } from './domain/entities/agent/ToolExecution';
import { TelegramLink } from './domain/entities/agent/TelegramLink';
import { TelegramLinkCode } from './domain/entities/agent/TelegramLinkCode';
import { WhatsappModule } from './application/services/agent/appModule/whatsapp.module';
import { WhatsappAuthCredential } from './domain/entities/agent/WhatsappAuthCredential';
import { WhatsappAuthKey } from './domain/entities/agent/WhatsappAuthKey';
import { WhatsappUserMapping } from './domain/entities/agent/WhatsappUserMapping';
import { TransportCompanyModule } from './application/module/TransportCompanyModule';

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
    ToolRegisterModule,
    ContextManagerModule,
    WhatsappModule,
    TransportCompanyModule
  ],
  controllers: [],
  providers: [OllamaAssistantService],
})
export class AppModule {}
