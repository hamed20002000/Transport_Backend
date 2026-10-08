import { User } from '../../entities/auth/User';
import { BotLink } from '../../entities/agent/BotLink';
import type { BotPlatform } from '../../../services/messengerBot/core/botPlatform';

export interface IBotLinkRepository {

   /**
   * از BotLink بات مربوط به کاربر رو به همراه کاربر و نقش  کاربر برمیگردونه
   * externalUserId همون chatidهستش
   * @param externalUserId 
   * @returns 
   */

  findByExternalUserId(
    externalUserId: string,
  ): Promise<BotLink | null>;

   /**
   * بات کاربر رو با استفاده از آیدی کاربر و پلتفرم(روبیکا-تلگرام-بله) به دست میاره
   * @param userId
   * @param platform 
   * @returns 
   */
  findByUserId(
    userId: string,
    platform?: BotPlatform,
  ): Promise<BotLink | null>;

  /**
   * همه بات های کاربر رو با استفاده از آیدیه کاربر به دست میاره 
   * @param userId 
   * @returns 
   */  findAllByUserId(userId: string): Promise<BotLink[]>;


     /**
   * کاربر و بات مربوطه رو همزمان به صورت اتمیک دخیره میکنه
   * ابتدا کاربر رو دخیره بعد بات کاربر رو در جدول BotLink ثبت میکنه
   * @param user
   * @param link 
   * @returns 
   */
  createUserWithLink(user: User, link: BotLink): Promise<BotLink>;

    /**
   * نقش کاربر رو ثبت میکنه
   * ابتدا از BotLink آیدی رو به دست میاره
   * از روی  آیدی خود کاربر رو به دست میاره
   * از کاربر نقش ها رو بررسی میکنه
   * اگه نقش داره که همون آیدی کاربر رو برمیگردنه
   * وگرنه نقش رو برای کاربر در جدول UserRole ثبت میکنه
   * در این مراحل چنانچه کاربر در  botlinkنباشه یا در کاربر ها نباشه یا نقش در جدول نقش اه نباشه exception مربوطه تولید میشه
   * @param externalUserId 
   * @param roleName 
   * @returns 
   */
  assignInitialRole(externalUserId: string, roleName: string): Promise<string>;



  /**
   * بات کاربر رودر جدول BotLink ذخیره میکنه
   * @param entity 
   * @returns 
   */
  save(
    entity: BotLink,
  ): Promise<BotLink>;
}