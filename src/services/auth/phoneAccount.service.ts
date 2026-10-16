import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { User } from 'src/domain/entities/auth/User';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { AccountType } from 'src/domain/enums/subscription';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';

/** نوع حسابی که کاربر خودش انتخاب می‌کند؛ کارگزار فعلاً در سامانه نیست. */
export const SELF_SERVICE_ACCOUNT_TYPES = [AccountType.Driver, AccountType.Company] as const;

/**
 * حساب فقط با شماره موبایل تأییدشده (OTP وب، دکمه‌ی «ارسال شماره» ربات‌ها، شماره‌ی واتساپ):
 * نام کاربری همان شماره است و رمز عبوری ندارد؛ ورود همیشه با شماره و کد پیامکی است.
 */
@Injectable()
export class PhoneAccountService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  findByPhone(phone: string): Promise<User | null> {
    return this.users.findByMobile(phone);
  }

  /** حساب تازه با این شماره و نقش؛ اگر هم‌زمان ساخته شده بود همان برمی‌گردد. */
  async create(phone: string, accountType: AccountType): Promise<User> {
    const user = Object.assign(new User(), {
      username: phone,
      mobile: phone,
      recordStatus: RecordStatus.Active,
    });
    try {
      return await this.users.createWithRole(user, accountType);
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === '23505') {
        const existing = await this.users.findByMobile(phone);
        if (existing) return (await this.users.findById(existing.id)) ?? existing;
        throw new ConflictException('This phone number or username is already in use.');
      }
      throw error;
    }
  }

  /** نقش فعال دارد؟ (همان نقش‌هایی که در توکن می‌آیند) */
  async hasRole(userId: string): Promise<boolean> {
    const user = await this.users.findById(userId);
    return !!user && new JwtPayload(user).roles.length > 0;
  }

  /** حسابی که نقش ندارد (مثلاً از ربات پیش از انتخاب نوع حساب) نقش اولیه می‌گیرد. */
  async assignRole(userId: string, accountType: AccountType): Promise<User> {
    await this.users.assignInitialRole(userId, accountType);
    return (await this.users.findById(userId))!;
  }
}
