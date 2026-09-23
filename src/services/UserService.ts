import { AccountType } from 'src/domain/enums/subscription';
import { QueryFailedError } from 'typeorm';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PasswordService } from './auth/password.service';

import { User } from 'src/domain/entities/auth/User';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,

    private readonly passwordService: PasswordService,
  ) {}

  async getByUserId(
    userId: string,
  ): Promise<User> {
    const user =
      await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException(
        'User not found.',
      );
    }

    return user;
  }

  async getByUsername(
    username: string,
  ): Promise<User> {
    const user =
      await this.userRepository.findByUsernameWithRoles(
        username.trim(),
      );

    if (!user) {
      throw new NotFoundException(
        'User not found.',
      );
    }

    return user;
  }

  async findByUsername(
    username: string,
  ): Promise<User | null> {
    return this.userRepository.findByUsernameWithRoles(
      username.trim(),
    );
  }

  async findByUsernameOrEmail(
    value: string,
  ): Promise<User | null> {
    return this.userRepository.findByUsernameOrEmailWithRoles(
      value.trim(),
    );
  }

  async create(
    username: string,
    password: string,
    email?: string,
    mobile?: string,
    accountType?: AccountType,
  ): Promise<User> {
    const normalizedUsername = username.trim();

    const existingUser =
      await this.userRepository.findByUsernameWithRoles(
        normalizedUsername,
      );

    if (existingUser) {
      throw new ConflictException(
        'Username already exists.',
      );
    }

    if (email) {
      const existingEmail =
        await this.userRepository.findByUsernameOrEmailWithRoles(
          email.trim(),
        );

      if (existingEmail) {
        throw new ConflictException(
          'Email already exists.',
        );
      }
    }

    const user = new User();

    user.username = normalizedUsername;

    user.passwordHash =
      await this.passwordService.hashPassword(
        password,
      );

    user.email =
      email?.trim() || undefined;

    user.mobile =
      mobile?.trim() || undefined;

    user.recordStatus =
      RecordStatus.Active;

    try {
      return accountType
        ? await this.userRepository.createWithRole(user, accountType)
        : await this.userRepository.create(user);
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && error.driverError?.code === '23505') {
        throw new ConflictException('Username, email or mobile already exists.');
      }
      throw error;
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user =
      await this.getByUserId(userId);

    const isValid =
      await this.passwordService.comparePasswords(
        currentPassword,
        user.passwordHash,
      );

    if (!isValid) {
      throw new ConflictException(
        'Current password is incorrect.',
      );
    }

    user.passwordHash =
      await this.passwordService.hashPassword(
        newPassword,
      );

    await this.userRepository.update(user);
  }

  async resetPassword(
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const user =
      await this.getByUserId(userId);

    user.passwordHash =
      await this.passwordService.hashPassword(
        newPassword,
      );

    await this.userRepository.update(user);
  }

  async updateRecordStatus(
    userId: string,
    recordStatus: RecordStatus,
  ): Promise<User> {
    const user =
      await this.getByUserId(userId);

    user.recordStatus = recordStatus;

    return this.userRepository.update(user);
  }
}