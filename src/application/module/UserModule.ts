import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/domain/entities/auth/User';

import { UserService } from 'src/services/UserService';
import { RedisModule } from './RedisModule';

import { UserProfileController } from 'src/presentation/controllers/user/user-profile.controller';
import { UserRepository } from 'src/infrastructure/repositories/UserRepository';

import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { CompanyProfileTools } from 'src/services/companyProfileTools';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
    ]),
    RedisModule,
  ],

  controllers: [UserProfileController],

  providers: [
    UserRepository,

    {
      provide: USER_REPOSITORY,
      useExisting: UserRepository,
    },

    UserService,
    // ابزارهای agent برای پروفایل
    CompanyProfileTools,
  ],

  exports: [
    USER_REPOSITORY,
    UserService,
  ],
})
export class UserModule {}