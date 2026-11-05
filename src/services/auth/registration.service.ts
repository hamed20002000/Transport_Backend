import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { normalizePhoneNumber } from 'src/dto/auth/phone-number';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { User } from 'src/domain/entities/auth/User';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { AccountType } from 'src/domain/enums/subscription';
import { RedisService } from '../redis/redis.service';
import { AccountSignedInEvent, REDIS_CHANNELS } from '../redis/redis.keys';
import { deviceName } from './deviceName';
import { invitedAccountTypes, markInvitesUsed } from '../company/inviteUsage';
import { PhoneAccountService, SELF_SERVICE_ACCOUNT_TYPES } from './phoneAccount.service';
import { SmsService } from './sms.service';
import { SessionService } from './session.service';
import { ParentCompanyLogin } from 'src/domain/entities/auth/ParentCompanyLogin';

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
  // the account types its invites allow (invitedAccountTypes); absent: any self-service type
  accountTypes?: AccountType[];
}

const OTP_TTL_SECONDS = 300;
const OTP_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;
// ۳ پیامک بدون ورود موفق → تا یک ساعت بعد از آخرین پیامک، کد تازه فرستاده نمی‌شود
const MAX_SENDS = 3;
const SENDS_BLOCK_SECONDS = 3600;
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
// the admin sign-in: this many wrong tries in a row, then a pause of this long for the username
const ADMIN_SIGN_IN_TRIES = 5;
const ADMIN_SIGN_IN_PAUSE_SECONDS = 15 * 60;

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly redis: RedisService,
    private readonly accounts: PhoneAccountService,
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  /**
   * فعلاً پیامک کار نمی‌کند: تا وقتی SMS_OTP_ENABLED=true نشده، پیامکی فرستاده نمی‌شود و
   * otp/verify هر کدی را می‌پذیرد. کد پیامک دست‌نخورده مانده؛ با همین env دوباره فعال می‌شود.
   */
  private get smsOtpEnabled(): boolean {
    return this.config.get<string>('SMS_OTP_ENABLED')?.trim().toLowerCase() === 'true';
  }

  /**
   * Accounts for whoever reviews the app (SMS providers, app stores): OTP_REVIEW_LOGINS="09120000000:12345,…".
   * Such a number gets no SMS; its fixed code (5–8 digits) is the code, with the same expiry and attempt limits.
   * Its company, factory or broker account is approved on login, so the reviewer sees the menus at once
   * (never a parent company: that one sees other accounts' profiles).
   */
  private reviewCode(phone: string): string | null {
    for (const entry of this.config.get<string>('OTP_REVIEW_LOGINS')?.split(',') ?? []) {
      const [number, code] = entry.split(':').map((part) => normalizePhoneNumber(part?.trim() ?? '') as string);
      if (number === phone && /^\d{5,8}$/.test(code ?? '')) return code;
    }
    return null;
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
      const sends = RedisService.key('registrationSends', phone);
      if (Number(await this.redis.get(sends)) >= MAX_SENDS) {
        const retryAfter = Math.max(1, await this.redis.ttl(sends));
        throw new HttpException(
          { statusCode: 429, message: `Too many codes requested. Try again in ${Math.ceil(retryAfter / 60)} minutes.`, retryAfter },
          429,
        );
      }
      const cooldown = RedisService.key('registrationCooldown', phone);
      if (!(await this.redis.setIfAbsent(cooldown, '1', OTP_COOLDOWN_SECONDS))) {
        throw new HttpException(`Wait ${OTP_COOLDOWN_SECONDS} seconds before requesting another code.`, 429);
      }
      const key = RedisService.key('registration', phone);
      try {
        // The SMS provider generates the code; only its digest is kept.
        const code = this.reviewCode(phone) ?? (await this.sms.sendOtp(phone));
        const pending: PendingOtp = { codeHash: this.digest(phone, code), expiresAt: Date.now() + OTP_TTL_SECONDS * 1000, attempts: 0 };
        await this.redis.setJson(key, pending, OTP_TTL_SECONDS);
        await this.redis.increment(sends, SENDS_BLOCK_SECONDS);
        await this.redis.expire(sends, SENDS_BLOCK_SECONDS);
        return { phoneNumber: phone, expiresIn: OTP_TTL_SECONDS, retryAfter: OTP_COOLDOWN_SECONDS };
      } catch (error) {
        await this.redis.delete(key, cooldown);
        throw error;
      }
    });
  }

  /**
   * کد درست: حساب فعال با نقش → توکن‌ها؛ وگرنه registrationToken برای انتخاب نوع حساب.
   * ورود به حساب موجود به گوشی‌های دیگر همان حساب اعلان می‌شود (signedIn)؛ device: دستگاهی که وارد شد.
   */
  async verifyOtp(phone: string, code: string, device: { userAgent?: string; pushEndpoint?: string } = {}) {
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
        await this.redis.delete(key, RedisService.key('registrationSends', phone));
      }

      // the parent company's people sign in to it, not to an account of their own
      const parent = await this.parentCompanyFor(phone);
      if (parent) return this.signIn(parent, device);

      const user = await this.accounts.findByPhone(phone);
      if (user && user.recordStatus !== RecordStatus.Active) throw new UnauthorizedException('This account is inactive.');
      const full = user ? await this.users.findById(user.id) : null;
      if (full && new JwtPayload(full).roles.length) {
        const tokens = await this.signIn(full, device);
        await markInvitesUsed(this.dataSource, full.mobile, this.redis);
        return tokens;
      }

      const signup: PendingSignup = { phone, ...(full ? { userId: full.id } : {}) };
      // an invited number is what it was invited as: one kind of invite signs it in as that at once, several leave
      // only those to choose
      const invitedAs = await invitedAccountTypes(this.dataSource, phone);
      if (invitedAs.length === 1) return this.signIn(await this.createAccount(signup, invitedAs[0]), device);
      if (invitedAs.length) signup.accountTypes = invitedAs;
      const registrationToken = randomBytes(32).toString('hex');
      await this.redis.setJson(RedisService.key('registrationToken', registrationToken), signup, SIGNUP_TTL_SECONDS);
      return {
        registrationRequired: true,
        registrationToken,
        phoneNumber: phone,
        expiresIn: SIGNUP_TTL_SECONDS,
        accountTypes: signup.accountTypes ?? [...SELF_SERVICE_ACCOUNT_TYPES],
      };
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
    if (signup.accountTypes && !signup.accountTypes.includes(accountType)) {
      throw new BadRequestException('این شماره با لینک دعوت آمده است؛ همان نوع حسابی را انتخاب کنید که دعوت شده است.');
    }
    return this.withLock(signup.phone, async () => this.signIn(await this.createAccount(signup, accountType), {}, true));
  }

  /** The account of a verified number gets its type (or is made with it), and its invites count as used. */
  private async createAccount(signup: PendingSignup, accountType: AccountType) {
    const existing = signup.userId ? null : await this.accounts.findByPhone(signup.phone);
    const user = signup.userId
      ? await this.accounts.assignRole(signup.userId, accountType)
      : existing
        ? await this.accounts.assignRole(existing.id, accountType)
        : await this.accounts.create(signup.phone, accountType);
    await markInvitesUsed(this.dataSource, signup.phone, this.redis);
    return user;
  }

  /**
   * The mobile of one of the parent company's people (ParentCompanyLogin): the parent company's account, to sign in
   * to instead of the number's own. Null for any other number, or when there is no active parent company.
   */
  private async parentCompanyFor(phone: string): Promise<User | null> {
    if (!(await this.dataSource.getRepository(ParentCompanyLogin).exists({ where: { mobile: phone } }))) return null;
    const parent = await this.dataSource.getRepository(User).findOne({
      where: { isParentCompany: true, recordStatus: RecordStatus.Active },
      order: { createdAt: 'ASC' },
      select: { id: true },
    });
    return parent ? this.users.findById(parent.id) : null;
  }

  /**
   * A sign-in: a new session (SessionService: for any account but the parent company it is now the only one, and the
   * other devices are signed out), its tokens, and the notice. quiet: no phone notification (a new account).
   */
  private async signIn(user: User, device: { userAgent?: string; pushEndpoint?: string } = {}, quiet = false) {
    const sid = await this.sessions.start(user.id, !!user.isParentCompany);
    const tokens = await this.issueTokens(user, sid);
    await this.signedIn(user.id, device, sid, quiet);
    return tokens;
  }

  /** best effort: a sign-in never fails because the notice could not be published */
  private async signedIn(userId: string, device: { userAgent?: string; pushEndpoint?: string }, sessionId: string, quiet = false): Promise<void> {
    const event: AccountSignedInEvent = {
      userId,
      device: deviceName(device.userAgent),
      at: new Date().toISOString(),
      ...(device.pushEndpoint ? { endpoint: device.pushEndpoint } : {}),
      sessionId,
      ...(quiet ? { quiet: true } : {}),
      noticeId: randomUUID(),
    };
    try {
      await this.redis.publish(REDIS_CHANNELS.accountSignedIn, JSON.stringify(event));
    } catch {
      // Redis down: the sign-in itself already succeeded
    }
  }

  /**
   * The admin panel's own sign-in: username and password (argon2 hash, User.passwordHash), for an account with the
   * ADMIN role only. A few wrong tries in a row pause the username for a while; the answer never tells which part
   * was wrong.
   */
  async adminSignIn(username: string, password: string) {
    const name = username.trim().toLowerCase();
    const failures = RedisService.key('adminSignInFailures', name);
    const tries = Number((await this.redis.get(failures)) ?? 0);
    if (tries >= ADMIN_SIGN_IN_TRIES) throw new HttpException('تلاش‌های ناموفق زیاد بود؛ چند دقیقه‌ی دیگر دوباره امتحان کنید.', HttpStatus.TOO_MANY_REQUESTS);
    const row = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('lower(user.username) = :name AND user.recordStatus = :active', { name, active: RecordStatus.Active })
      .getOne();
    const valid = !!row?.passwordHash && (await argon2.verify(row.passwordHash, password).catch(() => false));
    const user = valid ? await this.users.findById(row!.id) : null;
    if (!user || !new JwtPayload(user).roles.includes('ADMIN')) {
      await this.redis.increment(failures, ADMIN_SIGN_IN_PAUSE_SECONDS);
      throw new UnauthorizedException('نام کاربری یا رمز عبور درست نیست.');
    }
    await this.redis.delete(failures);
    return this.signIn(user, {}, true);
  }

  /** The token pair of a session; the refresh token keeps the session with the account («userId:sid»). */
  private async issueTokens(user: User, sid: string) {
    const payload: JwtPayload = { ...new JwtPayload(user), sid, ...(user.isParentCompany ? { multi: true } : {}) };
    if (!payload.isActive || payload.roles.length === 0) throw new UnauthorizedException();
    if (user.mobile && user.verificationStatus !== 'APPROVED' && this.reviewCode(user.mobile)) {
      await this.dataSource.getRepository(User).update(
        { id: user.id },
        { verificationStatus: 'APPROVED', verificationDecidedAt: new Date(), verificationNote: null },
      );
    }
    const accessToken = this.jwt.sign({ ...payload });
    const refreshToken = randomBytes(48).toString('hex');
    await this.redis.set(RedisService.key('refreshToken', refreshToken), `${user.id}:${sid}`, REFRESH_TTL_SECONDS);
    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  /** «userId:sid»; a refresh token from before sessions holds the user id only. */
  private static readRefresh(value: string): { userId: string; sid?: string } {
    const [userId, sid] = value.split(':');
    return { userId, sid: sid || undefined };
  }

  /** خروج از همین دستگاه: refresh token دیگر کار نمی‌کند و نشستش (اگر هنوز همان باشد) تمام می‌شود. */
  async revoke(token: string): Promise<void> {
    const value = await this.redis.take(RedisService.key('refreshToken', token));
    if (!value) return;
    const { userId, sid } = RegistrationService.readRefresh(value);
    await this.sessions.end(userId, sid);
  }

  /**
   * ورود خودکار: refresh token یک‌بارمصرف است و هر بار جفت تازه داده می‌شود؛ همان نشست ادامه پیدا می‌کند، مگر
   * جای دیگری وارد شده باشند (401 SESSION_REPLACED).
   */
  async refresh(token: string) {
    const value = await this.redis.take(RedisService.key('refreshToken', token));
    if (!value) throw new UnauthorizedException('Invalid or expired refresh token.');
    const { userId, sid } = RegistrationService.readRefresh(value);
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    const session = await this.sessions.resume(user.id, !!user.isParentCompany, sid);
    // someone already signed in before invites were marked on every way in: their app's next refresh marks them
    await markInvitesUsed(this.dataSource, user.mobile, this.redis);
    return this.issueTokens(user, session);
  }
}
