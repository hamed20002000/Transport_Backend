import { Injectable } from '@nestjs/common';
import { botNamespace } from './botPlatform';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { BotSessionState } from '../../../domain/enums/botSession';
import { BotSession } from '../../../domain/interfaces/botSession.interface';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class BotSessionService {
  private readonly ttlSeconds: number;
  private readonly namespace: string;

  constructor(private readonly redis: RedisService, config: ConfigService) {
    this.ttlSeconds = Number(config.get('TELEGRAM_SESSION_TTL_SECONDS', 86400));
    if (!Number.isSafeInteger(this.ttlSeconds) || this.ttlSeconds <= 0) {
      throw new Error('TELEGRAM_SESSION_TTL_SECONDS must be a positive integer.');
    }
    this.namespace = botNamespace(config);
  }

  /**
   * بررسی میکنید که آیانشست کاربر هنوز هست یا نه 
   * اگر هنوز  نشست داشته باشه اونو برمیگردونه 
   * البته اینجا دوتا نشست داریم یه نشستی که زمان انقضا داره مثل خرید سابسکریپشن و نشست های بعدی که زمان انقضا ندارند
   * نشستس که انقضا داره نباید با هر دسترسی که نشست دوباره تمدید بشه
   * ولی بقیه باید تمدیدبشن
   * @param externalUserId 
   * @returns 
   */

  //#region -------------------------- به دست اوردن نشست کاربر ----------------------------
  async get(externalUserId: string): Promise<BotSession | null> {
    const key = RedisService.key('telegramSession', this.namespace, externalUserId);
    const session = await this.redis.getJson<BotSession>(key);
    if (session === null) return null;
    // Fixed-deadline sessions (e.g. payment window) must not be extended by reads.
    if (session.expiresAt) return session;
    // Refresh expiry without overwriting a newer session value.
    return await this.redis.expire(key, this.ttlSeconds) ? session : null;
  }
  //#endregion --------------------------------------------------------------------------------

  /**
   * اگه کاربر نشست داشته باشه همون رو برمیگردونه وگرنه یه نشست تازه میسازه و اونو برمیگردونه
   * @param externalUserId 
   * @returns 
   */

  //#region ---------------------- نشست کاربر رو برمیگردونه یا یه نشست تازه میسازه -------------
  async getOrCreate(externalUserId: string): Promise<BotSession> {
    return await this.get(externalUserId) ?? await this.reset(externalUserId);
  }
  //#endregion ---------------------------------------------------------------------------------

  /**
   * نشست رو برای کاربر تنظیم میکنه
   * اگه نشست انقضا نداشته باشه همون ۳۰ دقیقه میزاره
   * اگه انقضا داشته باشه زمان انقضا منهای زمان جاری رو محاسبه میکنه
   * اکه زمان محاسبه شده کوچکتر از صفر باشه پاکش مکنه
   * نشست در ردیس دخیره میشه
   * @param externalUserId 
   * @param session 
   * @returns 
   */

  //#region ---------------------------- تنظیم نشست برای کاربر -----------------------
  async set(externalUserId: string, session: BotSession): Promise<void> {
    const ttlSeconds = session.expiresAt
      ? Math.ceil((session.expiresAt - Date.now()) / 1000)
      : this.ttlSeconds;
    if (ttlSeconds <= 0) {
      await this.delete(externalUserId);
      return;
    }
    await this.redis.setJson(RedisService.key('telegramSession', this.namespace, externalUserId), session, ttlSeconds);
  }
  //#endregion -------------------------------------------------------------------------


  /**
   * نشست کاربر رو بروز میکنه
   * اگه کاربر نشست داشته باشه همون رو با مقادیر جدید بروز میکنه اگه نداشته باشه یه نشست جدید میسازه و در ردیس ذخیره میکنه
   * @param externalUserId 
   * @param values 
   * @returns 
   */

  //#region -------------------------------- بروزرسانی نشست کاربر -------------------------------
  async update(
    externalUserId: string,
    values: Partial<BotSession>,
  ): Promise<BotSession> {
    const session = await this.get(externalUserId) ?? { state: BotSessionState.Idle };
    Object.assign(session, values);
    await this.set(externalUserId, session);
    return session;
  }
  //#endregion -----------------------------------------------------------------------------------

  /**
   * نشست کاربر رو رفرش میکنه
   * @param externalUserId 
   * @returns 
   */

  //#region --------------------------- رفرش کردن نشست کاربر ---------------------------
  async reset(externalUserId: string): Promise<BotSession> {
    const session: BotSession = { state: BotSessionState.Idle };
    await this.set(externalUserId, session);
    return session;
  }
  //#endregion ---------------------------------------------------------------------------

  /**
   * Runs `task` only if no other receipt for this user is being processed.
   * Returns `locked: true` without running it otherwise.
   */
  async withReceiptLock<T>(
    externalUserId: string,
    task: () => Promise<T>,
  ): Promise<{ locked: true } | { locked: false; result: T }> {
    const key = RedisService.key('telegramReceiptLock', this.namespace, externalUserId);
    const owner = randomBytes(16).toString('hex');
    // Covers download and database write; analysis runs in the background.
    if (!(await this.redis.setIfAbsent(key, owner, 300))) return { locked: true };
    try {
      return { locked: false, result: await task() };
    } finally {
      await this.redis.deleteIfValue(key, owner);
    }
  }

  /**
   * نشست کاربر رو پاک میکنه
   * @param externalUserId 
   */

  //#region -------------------------- پاک کردن نشست کاربر ---------------------------
  async delete(externalUserId: string): Promise<void> {
    await this.redis.delete(RedisService.key('telegramSession', this.namespace, externalUserId));
  }
  //#endregion ------------------------------------------------------------------------

}
