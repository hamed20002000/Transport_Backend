import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';



export const typeOrmConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',

  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),

  username: configService.get<string>('DB_USERNAME', 'postgres'),
  password: configService.getOrThrow<string>('123qwe$%'),

  database: configService.get<string>('DB_DATABASE', 'Transport'),
  entities: [
    'src/domain/**/*.ts',
    'src/application/services/agent/entities/*.ts',
  ],
  migrations: [
    'src/infrastructure/database/migrations/*.ts',
  ],
  migrationsRun: false,
  synchronize: false,

  logging: true,
});


