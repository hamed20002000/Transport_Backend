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
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { User } from 'src/domain/entities/auth/User';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { AccountType } from 'src/domain/enums/subscription';
import { RegisterDto } from 'src/dto/auth/register-dto';
import { RedisService } from '../redis/redis.service';
import { PasswordService } from './password.service';
import { SmsService } from './sms.service';

interface PendingRegistration {
  username: string;
  passwordHash: string;
  accountType: AccountType;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly sms: SmsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private key(phone: string): string {
    return `auth:registration:${phone}`;
  }

  private digest(phone: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET_KEY'))
      .update(`registration:${phone}:${code}`)
      .digest('hex');
  }

  private async withLock<T>(phone: string, operation: () => Promise<T>): Promise<T> {
    const key = `auth:registration-lock:${phone}`;
    const owner = randomBytes(16).toString('hex');
    if (!(await this.redis.setIfAbsent(key, owner, 120))) {
      throw new ConflictException('Another registration request is in progress.');
    }
    try {
      return await operation();
    } finally {
      await this.redis.deleteIfValue(key, owner);
    }
  }

  private async ensureAvailable(username: string, phone: string): Promise<void> {
    const [user, mobile] = await Promise.all([
      this.users.findByUsernameWithRoles(username),
      this.users.findByMobile(phone),
    ]);
    if (user) throw new ConflictException('Username already exists.');
    if (mobile) throw new ConflictException('Phone number already exists.');
  }

  async requestOtp(dto: RegisterDto) {
    return this.withLock(dto.phoneNumber, async () => {
      await this.ensureAvailable(dto.username, dto.phoneNumber);
      const cooldown = `auth:registration-cooldown:${dto.phoneNumber}`;
      if (!(await this.redis.setIfAbsent(cooldown, '1', 60))) {
        throw new HttpException('Wait 60 seconds before requesting another code.', 429);
      }
      const key = this.key(dto.phoneNumber);
      try {
        const code = randomInt(100000, 1000000).toString();
        const pending: PendingRegistration = {
          username: dto.username,
          passwordHash: await this.passwords.hashPassword(dto.password),
          accountType: dto.accountType,
          codeHash: this.digest(dto.phoneNumber, code),
          expiresAt: Date.now() + 300000,
          attempts: 0,
        };
        await this.redis.setJson(key, pending, 300);
        await this.sms.sendOtp(dto.phoneNumber, code);
        return { phoneNumber: dto.phoneNumber, expiresIn: 300, retryAfter: 60 };
      } catch (error) {
        await this.redis.delete(key, cooldown);
        throw error;
      }
    });
  }

  async verifyOtp(phone: string, code: string) {
    return this.withLock(phone, async () => {
      const key = this.key(phone);
      const pending = await this.redis.getJson<PendingRegistration>(key);
      if (!pending || pending.expiresAt <= Date.now()) {
        throw new BadRequestException('Registration code has expired or does not exist.');
      }
      if (pending.attempts >= 5) throw new HttpException('Too many incorrect attempts. Request a new code.', 429);
      const matches = timingSafeEqual(
        Buffer.from(pending.codeHash, 'hex'),
        Buffer.from(this.digest(phone, code), 'hex'),
      );
      if (!matches) {
        pending.attempts += 1;
        await this.redis.setJson(key, pending, Math.max(1, Math.ceil((pending.expiresAt - Date.now()) / 1000)));
        throw new BadRequestException('Invalid registration code.');
      }
      await this.ensureAvailable(pending.username, phone);
      const user = Object.assign(new User(), {
        username: pending.username,
        passwordHash: pending.passwordHash,
        mobile: phone,
        recordStatus: RecordStatus.Active,
        mustChangePassword: false,
      });
      let saved: User;
      try {
        saved = await this.users.createWithRole(user, pending.accountType);
      } catch (error) {
        if (error instanceof QueryFailedError && error.driverError?.code === '23505') {
          throw new ConflictException('Username or phone number already exists.');
        }
        throw error;
      }
      await this.redis.delete(key);
      return this.issueTokens(saved);
    });
  }

  private refreshKey(token: string): string {
    return `auth:refresh:${createHash('sha256').update(token).digest('hex')}`;
  }

  private async issueTokens(user: User) {
    const payload = new JwtPayload(user);
    if (!payload.isActive || payload.roles.length === 0) throw new UnauthorizedException();
    const accessToken = this.jwt.sign({ ...payload });
    const refreshToken = randomBytes(48).toString('hex');
    await this.redis.set(this.refreshKey(refreshToken), user.id, 30 * 24 * 3600);
    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  async refresh(token: string) {
    const userId = await this.redis.take(this.refreshKey(token));
    if (!userId) throw new UnauthorizedException('Invalid or expired refresh token.');
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return this.issueTokens(user);
  }
}
