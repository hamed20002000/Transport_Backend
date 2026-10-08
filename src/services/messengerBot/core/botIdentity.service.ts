import { ConfigService } from '@nestjs/config';
import { botNamespace, botPlatformOf } from './botPlatform';
import { RedisService } from '../../redis/redis.service';
import {
  Inject,
  Injectable,
  ConflictException,
} from '@nestjs/common';

import { BotLink } from '../../../domain/entities/agent/BotLink';

import { IBotLinkRepository } from '../../../domain/repositories/messengerBot/IBotLinkRepository';

import {
  BOT_LINK_REPOSITORY,
} from '../../../domain/repositories/repository.tokens';

@Injectable()
export class BotIdentityService {
  constructor(
    @Inject(BOT_LINK_REPOSITORY)
    private readonly repository: IBotLinkRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

 /**
  * کش کردن شناسه کاربر در ردیس که بعدا برای بررسی اینکه کاربر به سیستم وصل هست یا نه استفاده میشود
  * @param externalUserId 
  * @param userId 
  */

  //#region ----------------------------  ذخیره شناسه کاربر و شناسه چت که باید با هم برابر باشند ---------------
  async cacheUserId(externalUserId: string, userId: string): Promise<void> {
    const namespace = botNamespace(this.config);
    await this.redis.delete(RedisService.key('telegramIdentityRoles', namespace, externalUserId));
    await this.redis.set(RedisService.key('telegramIdentity', namespace, externalUserId), userId, 86400);
  }
  //#endregion -------------------------------------------------------------------------------------------------


  /**
   * نقش‌های کش‌شده‌ی منو در همه‌ی ربات‌های کاربر پاک می‌شود (مثلاً بعد از خرید نقش جدید). 
   * به عنوان مثال زمانی که نقش کاربر تغییر کرده و نقش موجود در ردیس نامعتبر هست
   * دفعه بعد که نقش لازم بود از دیتابیس مقدار جدیدخوانده شود
   * @param userId 
   * @returns 
   */

  //#region ----------------------------  پاک کردن نقش های کش شده ---------------
  async forgetRoles(userId: string): Promise<void> {
    const namespace = botNamespace(this.config);
    const links = await this.repository.findAllByUserId(userId);
    if (!links.length) return;
    await this.redis.delete(...links.map(link => RedisService.key('telegramIdentityRoles', namespace, link.externalUserId)));
  }
  //#endregion -------------------------------------------------------------------------------------------------

  
/**
 * به دست آوردن نقش های کاربر
 * در ضمن اگه کاربر قبلا نقشش در ردیس نباشه در اون ثبت میکنه
 */
  
//#region ----------------------------  گرفتن نقش های کاربر ---------------
  async getMenuRoles(externalUserId: string): Promise<string[] | null> {
    const namespace = botNamespace(this.config);
    const key = RedisService.key('telegramIdentityRoles', namespace, externalUserId);
    const roles = await this.redis.getJson<string[]>(key);
    if (roles !== null) return roles;
    const link = await this.repository.findByExternalUserId(externalUserId);
    if (!link?.userId || !link.user) return null;
    const names = link.user.userRoles?.filter(item => item.role != null).map(item => item.role.name) ?? [];
    await this.redis.setJson(key, names, 86400);
    return names;
  }
  //#endregion ---------------------------------------------------------------
 

  /**
   * به دست آوردن اطلاعات باتی که کاربر با آن درخواست داده
   * در حقیقت اینجا اطلاعات مسنجر کاربر که یا تلگرام هست یا روبیکا یا بله رو استخراج میکنیم
   * مانند firstname و lastname
   * اینجا externalUserId همون شناسه چت هست یعنی شناسه باتی که با برنامه در تماس هست
   * @param externalUserId 
   * @returns 
   */

  //#region ----------------------------  گرفتن اطلاعات بات کاربر ---------------
  async findByExternalUserId(
    externalUserId: string,
  ): Promise<BotLink | null> {
    return this.repository.findByExternalUserId(
      externalUserId,
    );
  }
  //#endregion --------------------------------------------------------------------


 /**
  * اطلاعات بات رو از رو شناسه کاربر 
  * @param userId 
  * @returns 
  */

 //#region ----------------------------  گرفتن اطلاعات بات کاربر از روی شناسه کاربر ---
  async findByUserId(
    userId: string,
  ): Promise<BotLink | null> {
    const links = await this.repository.findAllByUserId(userId);
    return links[0] ?? null;
  }
  //#endregion --------------------------------------------------------------------


  /**
   * کاربر را ابتدا در ردیس جستجو میکنه اکه نبود از جدول botlink دنبالش میگرده اگه بود تو ردیس دوباره کش میکنه و اگه نبود null برمیگردونه
   *اگه تو botlinkپیدا کنه به همراه نقش ها در ردیس ذخیره میکنه 
  * @param externalUserId 
   * @returns 
   */

   //#region ----------------------------  گرفتن شناسه کاربر از روی شناسه بات ---------------
  async getUserId(
    externalUserId: string,
  ): Promise<string | null> {
    const namespace = botNamespace(this.config);// ذخیره فضای نام که همون ایدی تلگرام هست
    try {
      //ابتدا redisرو بررسی میکنیم که کاربر اکه اونجا بود همون مقدار redisبرگشت داده میشه 
      const cached = await this.redis.get(RedisService.key('telegramIdentity', namespace, externalUserId));
      if (cached) return cached;
    } catch {
      // Redis unavailable: fall back to the database.
    }

    //اگه کاربر تو redisنبود دیتابیس رو بررسی میکنیم باید تو جدول botlink باشه
   
    const link = await this.repository.findByExternalUserId(externalUserId);//این متد اگه کاربر تو botlink باشه به همرا نقش هاش برمیگردونه
    if (link?.userId) {
      try {
        await this.cacheUserId(externalUserId, link.userId);//کاربر رو به همراه نقش در redis دخیره میکنه
        //اگه کاربر نقش داشته باشه نقش هارو هم تو redisذخیره میکنه
        if (link.user) {
          const roles = link.user.userRoles?.filter(item => item.role != null).map(item => item.role.name) ?? [];
          await this.redis.setJson(RedisService.key('telegramIdentityRoles', namespace, externalUserId), roles, 86400);
        }
      } catch {
        // Caching is best-effort; the database result is still valid.
      }
    }
    return link?.userId ?? null;
  }
  //#endregion --------------------------------------------------------------------



  /**
   * آیا کاربر قبلا ثبت نام کرده است
   * باید شناسه بات در ردیس و یا در جدول BotLinkباشد
   * @param externalUserId 
   * @returns 
   */

  //#region ----------------------------  بررسی ثبت نام کاربر ---------------
  async isRegistered(
    externalUserId: string,
  ): Promise<boolean> {
    return Boolean(await this.getUserId(externalUserId));
  }
  //#endregion --------------------------------------------------------------------
  

  /**
   * اگه کاربر قبلا از طریق بات ثبت نام کرده اطلاعاتش بروز میشود وگرنه هیچ کاری انجام  نمیدهد
   * @param params 
   * @returns 
   */

  //#region ----------------------------  بروز رسانی اطلاعات بات کاربر ---------------
  async touch(params: {
    externalUserId: string;
    chatId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<BotLink | null> {
    const link =
      await this.repository.findByExternalUserId(
        params.externalUserId,
      );

    /*
     * Do NOT create a database record
     * for anonymous Telegram users.
     */
    if (!link) {
      return null;
    }

    link.chatId =
      params.chatId;

    link.externalUsername =
      params.username;

    link.firstName =
      params.firstName;

    link.lastName =
      params.lastName;

    link.lastInteractionAt =
      new Date();

    return this.repository.save(
      link,
    );
  }
  //#endregion --------------------------------------------------------------------



  /**
   * ابتدا بررسی میکند بات با شناسه داده شده برای کاربر ثبت نباشد اگه ثبت نشده در اون صورت ثبت میکند
   * در نظر داشته باشید یک کاربر امکان داره از جند بات  متفاوت یعنی تلگرام وبله و روبیکا ثبت نام کنه که موردی ندارد 
   * ولی ثبت از همان بات با کاربر متفاوت نمیشود
   * @param params 
   * @returns 
   */
  //#region ----------------------------- ثبت بات جدید برای کاربر موجود -----------------
  async linkUser(params: {
    externalUserId: string;
    chatId: string;
    userId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<BotLink> {

    let link =
      await this.repository.findByExternalUserId(
        params.externalUserId,
      );

    if (link && link.userId !== params.userId) {
      throw new ConflictException('Messenger account is already linked.');
    }
    // هر کاربر در هر پیام‌رسان یک اتصال دارد (تلگرام، بله و روبیکا جدا).
    const existing = await this.repository.findByUserId(params.userId, botPlatformOf(params.externalUserId));
    if (existing && existing.externalUserId !== params.externalUserId) {
      throw new ConflictException('User is already linked to another account on this messenger.');
    }

    /*
     * BotLink does not exist yet.
     *
     * Now creation is allowed because
     * we have a real system User.
     */
    if (!link) {
      link =
        new BotLink();

      link.externalUserId =
        params.externalUserId;
    }

    link.userId =
      params.userId;

    link.chatId =
      params.chatId;

    link.externalUsername =
      params.username;

    link.firstName =
      params.firstName;

    link.lastName =
      params.lastName;

    link.lastInteractionAt =
      new Date();

    const saved = await this.repository.save(link);
    await this.cacheUserId(params.externalUserId, params.userId);
    return saved;
  }
  //#endregion ----------------------------------------------------------------------------------------
}
