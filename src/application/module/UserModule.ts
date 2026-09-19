import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from 'src/domain/entities/auth/User';

import { UserService } from 'src/services/UserService';
import { PasswordService } from 'src/services/auth/password.service';

import { UserRepository } from 'src/infrastructure/repositories/UserRepository';

import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
    ]),
  ],

  providers: [
    UserRepository,

    {
      provide: USER_REPOSITORY,
      useExisting: UserRepository,
    },

    PasswordService,
    UserService,
  ],

  exports: [
    USER_REPOSITORY,
    UserService,
    PasswordService,
  ],
})
export class UserModule {}