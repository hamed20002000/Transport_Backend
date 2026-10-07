import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';

import { KEY_PREFIXES, RedisKeyParts } from './redis.keys';

@Injectable()
export class RedisService implements OnModuleDestroy {
  /** Central key schema; preserve prefixes so existing Redis data remains usable. */
  static key<K extends keyof RedisKeyParts>(kind: K, ...parts: RedisKeyParts[K]): string {
    if (parts.some((part) => !part)) {
      throw new Error('Redis key parts must be non-empty.');
    }
    const identifiers = kind === 'refreshToken'
      ? [createHash('sha256').update((parts as RedisKeyParts['refreshToken'])[0]).digest('hex')]
      : parts.map(RedisService.escapePart);
    return [KEY_PREFIXES[kind], ...identifiers].join(':');
  }

  /**
   * شناسه‌های بله/روبیکا پیشوند دارند (bale:…، rubika:…)؛ ':' جداکننده‌ی کلید است
   * پس escape می‌شود. '%' هم escape می‌شود تا نگاشت یک‌به‌یک بماند؛ بقیه دست
   * نمی‌خورد تا کلیدهای فعلی (شناسه‌ی عددی تلگرام، uuid) همان قبلی بمانند.
   */
  private static escapePart(part: string): string {
    return part.replace(/%/g, '%25').replace(/:/g, '%3A');
  }

  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  /** اتصال جدا برای subscribe: اتصالی که subscribe کرده دستور دیگری اجرا نمی‌کند. */
  private subscriber?: Redis;
  private readonly handlers = new Map<string, Set<(message: string) => void>>();

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

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  /** پیام‌های کانال را به handler می‌دهد؛ بعد از قطع و وصل Redis خودکار دوباره subscribe می‌شود. */

  /**
   * برای سابسکرایب کردن هندلرها
   * @param channel 
   * @param handler 
   */
  //#region -----------------------------  سابسکرایب کردن --------------------------------
  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate();
      this.subscriber.on('error', () => {
        this.logger.warn('Redis subscriber connection error. Check Redis availability and configuration.');
      });
      this.subscriber.on('message', (from: string, message: string) => {
        for (const listener of this.handlers.get(from) ?? []) {
          try {
            listener(message);
          } catch (error) {
            this.logger.warn(`Redis message handler failed on ${from}: ${(error as Error).message}`);
          }
        }
      });
    }
    const listeners = this.handlers.get(channel) ?? new Set();
    listeners.add(handler);
    this.handlers.set(channel, listeners);
    if (listeners.size === 1) await this.subscriber.subscribe(channel);
  }
  //#endregion -----------------------------------------------------------------------------

  async onModuleDestroy(): Promise<void> {
    for (const connection of [this.client, this.subscriber]) {
      if (!connection) continue;
      try {
        if (connection.status === 'ready') await connection.quit();
      } catch {
        // quit ناموفق؛ disconnect پایین اتصال را به هر حال می‌بندد.
      } finally {
        // Also stop reconnection attempts when Redis is unavailable.
        connection.disconnect();
      }
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
