import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    // Refresh expiry without overwriting a newer session value.
    return await this.redis.expire(key, this.ttlSeconds) ? session : null;
  }

  async getOrCreate(telegramUserId: string): Promise<TelegramSession> {
    return await this.get(telegramUserId) ?? await this.reset(telegramUserId);
  }

  async set(telegramUserId: string, session: TelegramSession): Promise<void> {
    await this.redis.setJson(RedisService.key('telegramSession', this.botId, telegramUserId), session, this.ttlSeconds);
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

  async delete(telegramUserId: string): Promise<void> {
    await this.redis.delete(RedisService.key('telegramSession', this.botId, telegramUserId));
  }

}
