import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ConfigModule,
  ConfigService,
} from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { MulterModule } from '@nestjs/platform-express';
import { ServeStaticModule } from '@nestjs/serve-static';

import {
  AcceptLanguageResolver,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';

import * as path from 'path';
import { join } from 'node:path';

import { AuthModule } from './auth/auth.module';

import { fileUploadOptions } from './interceptors/file-option';

import { OllamaAssistantService } from './agent/ollama-assistant.service';

import { ToolRegisterModule } from './application/services/agent/appModule/toolregister.module';

import { ContextManagerModule } from './application/services/agent/appModule/contextManager.module';

import { WhatsappModule } from './application/services/agent/appModule/whatsapp.module';

import { TransportCompanyModule } from './application/module/TransportCompanyModule';

import { TelegramModule } from './application/module/TelegramModule';
import { RedisModule } from './application/module/RedisModule';

@Module({
  imports: [
    /*
     * =====================================================
     * Config
     * =====================================================
     */

    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    RedisModule,

    /*
     * =====================================================
     * i18n
     * =====================================================
     */

    I18nModule.forRoot({
      fallbackLanguage: 'fa',

      loaderOptions: {
        path: join(
          __dirname,
          '/i18n/',
        ),

        watch: true,
      },

      resolvers: [
        {
          use: QueryResolver,
          options: [
            'lang',
          ],
        },

        AcceptLanguageResolver,
      ],
    }),

    /*
     * =====================================================
     * Static Files
     * =====================================================
     */

    ServeStaticModule.forRoot(
      {
        rootPath: path.join(
          __dirname,
          '..',
          'uploads',
        ),

        serveRoot: '/uploads',
      },

      {
        rootPath: path.join(
          __dirname,
          '..',
          'cdn',
        ),

        serveRoot: '/cdn',
      },
    ),

    /*
     * =====================================================
     * Upload
     * =====================================================
     */

    MulterModule.registerAsync({
      useFactory: () =>
        fileUploadOptions,
    }),

    /*
     * =====================================================
     * Throttler
     * =====================================================
     */

    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),

    /*
     * =====================================================
     * Database
     * =====================================================
     */

    TypeOrmModule.forRootAsync({
      imports: [
        ConfigModule,
      ],

      inject: [
        ConfigService,
      ],

      useFactory: (
        configService: ConfigService,
      ) => ({
        type: 'postgres',

        host:
          configService.get<string>(
            'DB_HOST',
            'localhost',
          ),

        port:
          configService.get<number>(
            'DB_PORT',
            5432,
          ),

        username:
          configService.get<string>(
            'DB_USERNAME',
            'postgres',
          ),

        password:
          configService.get<string>(
            'DB_PASSWORD',
            '123qwe$%',
          ),

        database:
          configService.get<string>(
            'DB_DATABASE',
            'SetasportalDb',
          ),

        entities: [
          join(__dirname, 'domain', 'entities', '**', '*{.ts,.js}'),
        ],

        migrations: [
          'domain/migrations/*.ts',
        ],

        migrationsRun: false,

        synchronize: false,

        logging: true,

        logger:
          'advanced-console',
      }),
    }),

    /*
     * =====================================================
     * Application Modules
     * =====================================================
     */

    AuthModule,

    ToolRegisterModule,

    ContextManagerModule,

    WhatsappModule,

    TransportCompanyModule,

    /*
     * TelegramModule باید حتماً اینجا باشد.
     *
     * با load شدن این Module،
     * TelegramService ساخته می‌شود و
     * onModuleInit آن اجرا خواهد شد.
     */
    TelegramModule,
  ],

  controllers: [],

  providers: [
    OllamaAssistantService,
  ],
})
export class AppModule {}
