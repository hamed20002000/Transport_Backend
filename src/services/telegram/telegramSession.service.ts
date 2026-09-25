import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { TelegramSessionState } from '../../domain/enums/telegram';
import { TelegramSession } from '../../domain/interfaces/telegram.interface';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class TelegramSessionService {
  private readonly ttlSeconds: number;
  private readonly botId: string;

  constructor(private readonly redis: RedisService, config: ConfigService) {
    this.ttlSeconds = Number(config.get('TELEGRAM_SESSION_TTL_SECONDS', 86400));
    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new Error('TELEGRAM_SESSION_TTL_SECONDS must be a positive integer.');
    }
    this.botId = config.get<string>('TELEGRAM_BOT_TOKEN', '').split(':')[0];
  }

  async get(telegramUserId: string): Promise<TelegramSession | null> {
    const key = RedisService.key('telegramSession', this.botId, telegramUserId);
    const session = await this.redis.getJson<TelegramSession>(key);
    if (session === null) return null;
    // Fixed-deadline sessions (e.g. payment window) must not be extended by reads.
    if (session.expiresAt) return session;
    // Refresh expiry without overwriting a newer session value.
    return await this.redis.expire(key, this.ttlSeconds) ? session : null;
  }

  async getOrCreate(telegramUserId: string): Promise<TelegramSession> {
    return await this.get(telegramUserId) ?? await this.reset(telegramUserId);
  }

  async set(telegramUserId: string, session: TelegramSession): Promise<void> {
    const ttlSeconds = session.expiresAt
      ? Math.ceil((session.expiresAt - Date.now()) / 1000)
      : this.ttlSeconds;
    if (ttlSeconds <= 0) {
      await this.delete(telegramUserId);
      return;
    }
    await this.redis.setJson(RedisService.key('telegramSession', this.botId, telegramUserId), session, ttlSeconds);
  }

  async update(
    telegramUserId: string,
    values: Partial<TelegramSession>,
  ): Promise<TelegramSession> {
    const session = await this.get(telegramUserId) ?? { state: TelegramSessionState.Idle };
    Object.assign(session, values);
    await this.set(telegramUserId, session);
    return session;
  }

  async reset(telegramUserId: string): Promise<TelegramSession> {
    const session: TelegramSession = { state: TelegramSessionState.Idle };
    await this.set(telegramUserId, session);
    return session;
  }

  /**
   * Runs `task` only if no other receipt for this user is being processed.
   * Returns `locked: true` without running it otherwise.
   */
  async withReceiptLock<T>(
    telegramUserId: string,
    task: () => Promise<T>,
  ): Promise<{ locked: true } | { locked: false; result: T }> {
    const key = RedisService.key('telegramReceiptLock', this.botId, telegramUserId);
    const owner = randomBytes(16).toString('hex');
    // Covers download and database write; analysis runs in the background.
    if (!(await this.redis.setIfAbsent(key, owner, 300))) return { locked: true };
    try {
      return { locked: false, result: await task() };
    } finally {
      await this.redis.deleteIfValue(key, owner);
    }
  }

  async delete(telegramUserId: string): Promise<void> {
    await this.redis.delete(RedisService.key('telegramSession', this.botId, telegramUserId));
  }

}
