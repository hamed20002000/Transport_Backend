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

  async findByTelegramUserId(
    telegramUserId: string,
  ): Promise<BotLink | null> {
    return this.repository.findOne({
      where: {
        telegramUserId,
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

  async findAllByUserId(userId: string): Promise<BotLink[]> {
    return this.repository.find({ where: { userId }, order: { lastInteractionAt: { direction: 'DESC', nulls: 'LAST' } } });
  }

  async createUserWithLink(user: User, link: BotLink): Promise<BotLink> {
    return this.repository.manager.transaction(async manager => {
      const saved = await manager.save(User, user);
      link.userId = saved.id;
      link.platform = botPlatformOf(link.telegramUserId);
      return manager.save(BotLink, link);
    });
  }

  async assignInitialRole(telegramUserId: string, roleName: string): Promise<string> {
    return this.repository.manager.transaction(async manager => {
      const link = await manager.findOne(BotLink, { where: { telegramUserId } });
      if (!link?.userId) throw new NotFoundException('Telegram account is not linked.');
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

  async save(
    entity: BotLink,
  ): Promise<BotLink> {
    entity.platform = botPlatformOf(entity.telegramUserId);
    return this.repository.save(
      entity,
    );
  }
}