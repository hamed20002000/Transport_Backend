import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { BotPlatform } from './botPlatform';

const CODE_TTL_SECONDS = 10 * 60;
// wrong codes one messenger account may send before it waits: 6 digits cannot be guessed at this rate
const MAX_ATTEMPTS = 5;
const ATTEMPTS_WINDOW_SECONDS = 10 * 60;

/**
 * Linking a messenger account from the web panel, where the user is already signed in with their number and SMS
 * code: the panel shows a one-time code and the user sends it to the bot. For Eitaa, where the bot is an ordinary
 * account and cannot ask for a verified phone number like the Telegram/Bale/Rubika «share number» button.
 */
@Injectable()
export class MessengerLinkCodeService {
  constructor(private readonly redis: RedisService) {}

  /** A new code for this user (the previous one stops working). */
  async create(platform: BotPlatform, userId: string): Promise<{ code: string; expiresIn: number }> {
    const userKey = RedisService.key('messengerLinkUser', platform, userId);
    const previous = await this.redis.get(userKey);
    if (previous) await this.redis.delete(RedisService.key('messengerLinkCode', platform, previous));
    for (;;) {
      const code = String(randomInt(100000, 1000000));
      if (await this.redis.setIfAbsent(RedisService.key('messengerLinkCode', platform, code), userId, CODE_TTL_SECONDS)) {
        await this.redis.set(userKey, code, CODE_TTL_SECONDS);
        return { code, expiresIn: CODE_TTL_SECONDS };
      }
    }
  }

  /**
   * The user the code belongs to (used up), null for a wrong or expired code, 'limited' after too many wrong ones.
   */
  async consume(platform: BotPlatform, externalUserId: string, code: string): Promise<string | null | 'limited'> {
    const attemptsKey = RedisService.key('messengerLinkAttempts', externalUserId);
    if (Number(await this.redis.get(attemptsKey)) >= MAX_ATTEMPTS) return 'limited';
    const userId = await this.redis.take(RedisService.key('messengerLinkCode', platform, code));
    if (!userId) {
      await this.redis.increment(attemptsKey, ATTEMPTS_WINDOW_SECONDS);
      return null;
    }
    await this.redis.delete(RedisService.key('messengerLinkUser', platform, userId), attemptsKey);
    return userId;
  }
}

/** The 6-digit code in what the user sent (Persian or Latin digits, alone or in a sentence). */
export function linkCodeIn(text: string | undefined): string | null {
  const digits = (text ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .match(/(?<!\d)\d{6}(?!\d)/);
  return digits ? digits[0] : null;
}
