import { randomBytes } from 'crypto';
import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

import { RedisService } from '../redis/redis.service';

/** How long one unlock lets the admin look at receipts. */
export const RECEIPT_VIEW_TTL_SECONDS = 15 * 60;
// wrong passwords per admin before unlocking is refused for the rest of the window
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_SECONDS = 15 * 60;

/**
 * A second lock on payment receipt photos, on top of the ADMIN role: a password whose argon2 hash only the
 * server's environment holds (RECEIPT_VIEW_PASSWORD_HASH; `npm run receipt-password` makes one). Entering it
 * gives that admin a short-lived token the image endpoint asks for. Without the hash nothing is shown.
 * Wrong passwords (403, not 401: 401 makes the panel renew its login) are counted and then refused (429).
 */
@Injectable()
export class ReceiptAccessService {
  private readonly logger = new Logger(ReceiptAccessService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  async unlock(adminUserId: string, password: string): Promise<{ token: string; expiresAt: string }> {
    const hash = this.config.get<string>('RECEIPT_VIEW_PASSWORD_HASH')?.trim();
    if (!hash) throw new ServiceUnavailableException('رمز مشاهده‌ی رسیدها هنوز روی سرور تعریف نشده است.');

    const attemptsKey = RedisService.key('receiptUnlockAttempts', adminUserId);
    if (Number(await this.redis.get(attemptsKey)) >= MAX_ATTEMPTS) {
      throw new HttpException('رمز چند بار اشتباه وارد شده است؛ ۱۵ دقیقه‌ی دیگر دوباره امتحان کنید.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const valid = await argon2.verify(hash, password).catch(() => false);
    if (!valid) {
      const attempts = await this.redis.increment(attemptsKey, ATTEMPT_WINDOW_SECONDS);
      this.logger.warn(`Wrong receipt password from admin ${adminUserId} (${attempts}/${MAX_ATTEMPTS})`);
      throw new ForbiddenException('رمز اشتباه است.');
    }

    await this.redis.delete(attemptsKey);
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(RedisService.key('receiptViewToken', token), adminUserId, RECEIPT_VIEW_TTL_SECONDS);
    this.logger.log(`Admin ${adminUserId} unlocked payment receipts`);
    return { token, expiresAt: new Date(Date.now() + RECEIPT_VIEW_TTL_SECONDS * 1000).toISOString() };
  }

  /** The token must have been given to this very admin, and still be valid. */
  async assertUnlocked(adminUserId: string, token: string | undefined): Promise<void> {
    const owner = token ? await this.redis.get(RedisService.key('receiptViewToken', token)) : null;
    if (!owner || owner !== adminUserId) throw new ForbiddenException('برای دیدن رسیدها دوباره رمز را وارد کنید.');
  }
}
