import { User } from '../../../domain/entities/auth/User';
import { Role } from '../../../domain/entities/auth/Role';
import { UserRole } from '../../../domain/entities/auth/UserRole';
import { RecordStatus } from '../../../domain/enums/RecordStatus';
import { NotFoundException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BotLink } from '../../../domain/entities/agent/BotLink';
import { IBotLinkRepository } from '../../../domain/repositories/messengerBot/IBotLinkRepository';
import { BotPlatform, botPlatformOf } from '../../../services/messengerBot/core/botPlatform';

@Injectable()
export class BotLinkRepository
  implements IBotLinkRepository
{
  constructor(
    @InjectRepository(BotLink)
    private readonly repository:
      Repository<BotLink>,
  ) {}


  /**
   * از BotLink بات مربوط به کاربر رو به همراه کاربر و نقش  کاربر برمیگردونه
   * externalUserId همون chatidهستش
   * @param externalUserId 
   * @returns 
   */

  //#region -------------------------- به دست آوردن بات مربوط به chatid که همون externalUserId هست -----------
  async findByExternalUserId(
    externalUserId: string,
  ): Promise<BotLink | null> {
    return this.repository.findOne({
      where: {
        externalUserId,
      },
      relations: {
        user: {
          userRoles: {
            role: true,
          },
        },
      },
    });
  }
  //#endregion -----------------------------------------------------------------------------------------------

  /**
   * بات کاربر رو با استفاده از آیدی کاربر و پلتفرم(روبیکا-تلگرام-بله) به دست میاره
   * @param userId
   * @param platform 
   * @returns 
   */

  //#region ------------------------- به دست آوردن بات کاربر با آیدیه کاربر ---------------------
  async findByUserId(
    userId: string,
    platform: BotPlatform = 'telegram',
  ): Promise<BotLink | null> {
    return this.repository.findOne({
      where: {
        userId,
        platform,
      },
      relations: {
        user: {
          userRoles: {
            role: true,
          },
        },
      },
    });
  }
  //#endregion ---------------------------------------------------------------------------------------


  /**
   * همه بات های کاربر رو با استفاده از آیدیه کاربر به دست میاره 
   * @param userId 
   * @returns 
   */
  //#region -------------------------- به دست آوردن بات های کاربر -------------------------------------
  async findAllByUserId(userId: string): Promise<BotLink[]> {
    return this.repository.find({ where: { userId }, order: { lastInteractionAt: { direction: 'DESC', nulls: 'LAST' } } });
  }
  //#endregion -----------------------------------------------------------------------------------------

  /**
   * کاربر و بات مربوطه رو همزمان به صورت اتمیک دخیره میکنه
   * ابتدا کاربر رو دخیره بعد بات کاربر رو در جدول BotLink ثبت میکنه
   * @param user
   * @param link 
   * @returns 
   */
  //#region --------------------------- ثبت کاربر و نقش کاربر -------------------------------------------
  async createUserWithLink(user: User, link: BotLink): Promise<BotLink> {
    return this.repository.manager.transaction(async manager => {
      const saved = await manager.save(User, user);
      link.userId = saved.id;
      link.platform = botPlatformOf(link.externalUserId);
      return manager.save(BotLink, link);
    });
  }
  //#endregion -------------------------------------------------------------------------------------------


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

  //#region --------------------------- ثبت نقش برای کاربر --------------------------------
  async assignInitialRole(externalUserId: string, roleName: string): Promise<string> {
    return this.repository.manager.transaction(async manager => {
      const link = await manager.findOne(BotLink, { where: { externalUserId } });
      if (!link?.userId) throw new NotFoundException('Messenger account is not linked.');
      const user = await manager.findOne(User, {
        where: { id: link.userId, recordStatus: RecordStatus.Active },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('Active user not found.');
      // Serialize initial role selection; repeated callbacks cannot add more roles.
      const assigned = await manager.findOne(UserRole, { where: { userId: user.id } });
      if (assigned) return user.id;
      const role = await manager.findOne(Role, { where: { name: roleName, recordStatus: RecordStatus.Active } });
      if (!role) throw new NotFoundException('Active account role not found.');
      await manager.save(UserRole, manager.create(UserRole, { userId: user.id, roleId: role.id }));
      return user.id;
    });
  }
  //#endregion --------------------------------------------------------------------------------


  /**
   * بات کاربر رودر جدول BotLink ذخیره میکنه
   * @param entity 
   * @returns 
   */

  //#region ----------------------------- ذخیره بات کاربر  -------------------------------------
  async save(
    entity: BotLink,
  ): Promise<BotLink> {
    entity.platform = botPlatformOf(entity.externalUserId);
    return this.repository.save(
      entity,
    );
  }
  //#endregion ------------------------------------------------------------------------------------
}