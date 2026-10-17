import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { User } from 'src/domain/entities/auth/User';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { AccountType } from 'src/domain/enums/subscription';
import { RedisService } from '../redis/redis.service';
import { PhoneAccountService, SELF_SERVICE_ACCOUNT_TYPES } from './phoneAccount.service';
import { SmsService } from './sms.service';

interface PendingOtp {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

/** شماره‌ای که OTP را تأیید کرده ولی حساب (یا نقش) ندارد؛ تا انتخاب نوع حساب. */
interface PendingSignup {
  phone: string;
  // حساب بی‌نقش (مثلاً ساخته‌شده در ربات پیش از انتخاب نوع حساب)
  userId?: string;
}

const OTP_TTL_SECONDS = 300;
const OTP_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const SIGNUP_TTL_SECONDS = 600;
const REFRESH_TTL_SECONDS = 30 * 24 * 3600;

/**
 * ثبت‌نام و ورود وب فقط با موبایل و OTP:
 *   ۱. otp/request: کد پیامکی
 *   ۲. otp/verify: حساب هست → Access + Refresh Token؛ نیست → registrationToken (یک‌بارمصرف)
 *   ۳. otp/complete: نوع حساب (راننده/شرکت) → ساخت حساب → توکن‌ها
 * ورود بعدی خودکار با Refresh Token است (refresh). حساب بعد از تأیید کد ساخته می‌شود، پس
 * تا پیش از آن معلوم نمی‌شود چه شماره‌ای عضو است.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly redis: RedisService,
    private readonly accounts: PhoneAccountService,
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * فعلاً پیامک کار نمی‌کند: تا وقتی SMS_OTP_ENABLED=true نشده، پیامکی فرستاده نمی‌شود و
   * otp/verify هر کدی را می‌پذیرد. کد پیامک دست‌نخورده مانده؛ با همین env دوباره فعال می‌شود.
   */
  private get smsOtpEnabled(): boolean {
    return this.config.get<string>('SMS_OTP_ENABLED')?.trim().toLowerCase() === 'true';
  }

  private digest(phone: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET_KEY'))
      .update(`registration:${phone}:${code}`)
      .digest('hex');
  }

  private async withLock<T>(phone: string, operation: () => Promise<T>): Promise<T> {
    const key = RedisService.key('registrationLock', phone);
    const owner = randomBytes(16).toString('hex');
    if (!(await this.redis.setIfAbsent(key, owner, 120))) {
      throw new ConflictException('Another request for this phone number is in progress.');
    }
    try {
      return await operation();
    } finally {
      await this.redis.deleteIfValue(key, owner);
    }
  }

  async requestOtp(phone: string) {
    if (!this.smsOtpEnabled) return { phoneNumber: phone, expiresIn: OTP_TTL_SECONDS, retryAfter: 0 };
    return this.withLock(phone, async () => {
      const cooldown = RedisService.key('registrationCooldown', phone);
      if (!(await this.redis.setIfAbsent(cooldown, '1', OTP_COOLDOWN_SECONDS))) {
        throw new HttpException(`Wait ${OTP_COOLDOWN_SECONDS} seconds before requesting another code.`, 429);
      }
      const key = RedisService.key('registration', phone);
      try {
        // The SMS provider generates the code; only its digest is kept.
        const code = await this.sms.sendOtp(phone);
        const pending: PendingOtp = { codeHash: this.digest(phone, code), expiresAt: Date.now() + OTP_TTL_SECONDS * 1000, attempts: 0 };
        await this.redis.setJson(key, pending, OTP_TTL_SECONDS);
        return { phoneNumber: phone, expiresIn: OTP_TTL_SECONDS, retryAfter: OTP_COOLDOWN_SECONDS };
      } catch (error) {
        await this.redis.delete(key, cooldown);
        throw error;
      }
    });
  }

  /** کد درست: حساب فعال با نقش → توکن‌ها؛ وگرنه registrationToken برای انتخاب نوع حساب. */
  async verifyOtp(phone: string, code: string) {
    return this.withLock(phone, async () => {
      if (this.smsOtpEnabled) {
        const key = RedisService.key('registration', phone);
        const pending = await this.redis.getJson<PendingOtp>(key);
        if (!pending || pending.expiresAt <= Date.now()) {
          throw new BadRequestException('Verification code has expired or does not exist.');
        }
        if (pending.attempts >= MAX_ATTEMPTS) throw new HttpException('Too many incorrect attempts. Request a new code.', 429);
        const matches = timingSafeEqual(Buffer.from(pending.codeHash, 'hex'), Buffer.from(this.digest(phone, code), 'hex'));
        if (!matches) {
          pending.attempts += 1;
          await this.redis.setJson(key, pending, Math.max(1, Math.ceil((pending.expiresAt - Date.now()) / 1000)));
          throw new BadRequestException('Invalid verification code.');
        }
        await this.redis.delete(key);
      }

      const user = await this.accounts.findByPhone(phone);
      if (user && user.recordStatus !== RecordStatus.Active) throw new UnauthorizedException('This account is inactive.');
      const full = user ? await this.users.findById(user.id) : null;
      if (full && new JwtPayload(full).roles.length) return this.issueTokens(full);

      const registrationToken = randomBytes(32).toString('hex');
      const signup: PendingSignup = { phone, ...(full ? { userId: full.id } : {}) };
      await this.redis.setJson(RedisService.key('registrationToken', registrationToken), signup, SIGNUP_TTL_SECONDS);
      return { registrationRequired: true, registrationToken, phoneNumber: phone, expiresIn: SIGNUP_TTL_SECONDS };
    });
  }

  /** نوع حساب بعد از تأیید شماره: ساخت حساب (یا نقش حساب بی‌نقش) و ورود. */
  async completeRegistration(registrationToken: string, accountType: AccountType) {
    if (!(SELF_SERVICE_ACCOUNT_TYPES as readonly AccountType[]).includes(accountType)) {
      throw new BadRequestException('Choose a driver or company account.');
    }
    const raw = await this.redis.take(RedisService.key('registrationToken', registrationToken));
    if (!raw) throw new UnauthorizedException('Registration has expired; verify your phone number again.');
    const signup = JSON.parse(raw) as PendingSignup;
    return this.withLock(signup.phone, async () => {
      const existing = signup.userId ? null : await this.accounts.findByPhone(signup.phone);
      const user = signup.userId
        ? await this.accounts.assignRole(signup.userId, accountType)
        : existing
          ? await this.accounts.assignRole(existing.id, accountType)
          : await this.accounts.create(signup.phone, accountType);
      return this.issueTokens(user);
    });
  }

  private async issueTokens(user: User) {
    const payload = new JwtPayload(user);
    if (!payload.isActive || payload.roles.length === 0) throw new UnauthorizedException();
    const accessToken = this.jwt.sign({ ...payload });
    const refreshToken = randomBytes(48).toString('hex');
    await this.redis.set(RedisService.key('refreshToken', refreshToken), user.id, REFRESH_TTL_SECONDS);
    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  /** خروج از همین دستگاه: refresh token دیگر کار نمی‌کند. */
  async revoke(token: string): Promise<void> {
    await this.redis.delete(RedisService.key('refreshToken', token));
  }

  /** ورود خودکار: refresh token یک‌بارمصرف است و هر بار جفت تازه داده می‌شود. */
  async refresh(token: string) {
    const userId = await this.redis.take(RedisService.key('refreshToken', token));
    if (!userId) throw new UnauthorizedException('Invalid or expired refresh token.');
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.issueTokens(user);
  }
}
