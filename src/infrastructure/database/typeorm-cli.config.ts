import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const typeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',

  host: configService.getOrThrow<string>('DB_HOST'),
  port: configService.get<number>('DB_PORT', 5432),

  username: configService.getOrThrow<string>('DB_USERNAME'),
  password: configService.getOrThrow<string>('DB_PASSWORD'),

  database: configService.getOrThrow<string>('DB_DATABASE'),

  entities: [
    'src/domain/entities/**/*.ts',
  ],

  migrations: [
    'src/infrastructure/database/migrations/*.ts',
  ],

  migrationsRun: false,
  synchronize: false,

  logging: true,
});