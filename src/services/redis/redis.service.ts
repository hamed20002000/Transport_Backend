import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(config: ConfigService) {
    const port = Number(config.get<string | number>('REDIS_PORT', 6379));
    const db = Number(config.get<string | number>('REDIS_DB', 0));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('REDIS_PORT must be an integer between 1 and 65535.');
    }
    if (!Number.isSafeInteger(db) || db < 0) {
      throw new Error('REDIS_DB must be a non-negative integer.');
    }

    this.client = new Redis({
      host: config.get<string>('REDIS_HOST', '127.0.0.1'),
      port,
      db,
      username: config.get<string>('REDIS_USERNAME') || undefined,
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
      connectTimeout: 5000,
      commandTimeout: 5000,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', () => {
      this.logger.warn('Redis connection error. Check Redis availability and configuration.');
    });
  }

  /** Store text with a required positive TTL in seconds, atomically. */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.validateTtl(ttlSeconds);
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.validateTtl(ttlSeconds);
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError('Redis JSON value must be serializable.');
    }
    await this.set(key, serialized, ttlSeconds);
  }

  /** T describes the expected shape; it does not perform runtime validation. */
  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    return value === null ? null : JSON.parse(value) as T;
  }

  async delete(...keys: string[]): Promise<number> {
    return keys.length === 0 ? 0 : this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    this.validateTtl(ttlSeconds);
    return (await this.client.expire(key, ttlSeconds)) === 1;
  }

  /** Remaining seconds; -2 means missing, -1 means no expiration. */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.client.status === 'ready') await this.client.quit();
    } finally {
      // Also stop reconnection attempts when Redis is unavailable.
      this.client.disconnect();
    }
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    this.validateTtl(ttlSeconds);
    return (await this.client.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async deleteIfValue(key: string, value: string): Promise<void> {
    await this.client.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1, key, value,
    );
  }

  async take(key: string): Promise<string | null> {
    return await this.client.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]) end; return value",
      1, key,
    ) as string | null;
  }

  private validateTtl(ttlSeconds: number): void {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError('Redis TTL must be a positive integer in seconds.');
    }
  }
}
