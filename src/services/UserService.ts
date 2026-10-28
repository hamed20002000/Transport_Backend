import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { User } from 'src/domain/entities/auth/User';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

import { UpdateUserProfileDto } from 'src/dto/user/update-user-profile.dto';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { RedisService } from 'src/services/redis/redis.service';
import { ProfileContactChangedEvent, REDIS_CHANNELS } from 'src/services/redis/redis.keys';

const PROFILE_FIELDS = [
  'profileType',
  'firstName',
  'lastName',
  'nationalCode',
  'companyName',
  'domesticCompanyName',
  'internationalCompanyName',
  'companyNationalId',
  'economicCode',
  'registrationNo',
  'phone',
  'postalCode',
  'address',
  'cargoDisplay',
] as const;

// what a published cargo shows of its company (CargoAudienceRepository.findPublisherContact)
const CONTACT_FIELDS = ['profileType', 'firstName', 'lastName', 'companyName', 'domesticCompanyName', 'internationalCompanyName', 'phone'] as const;

export type UserProfile = Pick<User, 'id' | 'username' | 'email' | 'mobile' | 'accountCode' | (typeof PROFILE_FIELDS)[number]>;

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly redis: RedisService,
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

  async updateRecordStatus(
    userId: string,
    recordStatus: RecordStatus,
  ): Promise<User> {
    const user =
      await this.getByUserId(userId);

    user.recordStatus = recordStatus;

    return this.userRepository.update(user);
  }

  async getProfile(userId: string): Promise<UserProfile> {
    return this.toProfile(await this.getByUserId(userId));
  }

  // فقط فیلدهای ارسال‌شده تغییر می‌کنند؛ null مقدار قبلی را پاک می‌کند.
  async updateProfile(userId: string, dto: UpdateUserProfileDto): Promise<UserProfile> {
    const user = await this.getByUserId(userId);

    const changes: Partial<User> = {};
    for (const field of PROFILE_FIELDS) {
      if (dto[field] !== undefined) Object.assign(changes, { [field]: dto[field] });
    }
    const before = Object.fromEntries(CONTACT_FIELDS.map((field) => [field, user[field] ?? null]));
    Object.assign(user, changes);

    const saved = await this.userRepository.update(user);
    // the company's loads already announced carry the old name and phone; CargoContactSync updates them
    if (CONTACT_FIELDS.some((field) => (saved[field] ?? null) !== before[field])) {
      const event: ProfileContactChangedEvent = { userId, before };
      await this.redis.publish(REDIS_CHANNELS.profileContactChanged, JSON.stringify(event)).catch(() => undefined);
    }
    return this.toProfile(saved);
  }

  private toProfile(user: User): UserProfile {
    const profile: Record<string, unknown> = {
      id: user.id,
      username: user.username,
      email: user.email ?? null,
      mobile: user.mobile ?? null,
      accountCode: user.accountCode ?? null,
    };
    for (const field of PROFILE_FIELDS) profile[field] = user[field] ?? null;
    return profile as UserProfile;
  }
}
