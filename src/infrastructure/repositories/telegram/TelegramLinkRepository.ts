import { User } from '../../../domain/entities/auth/User';
import { Role } from '../../../domain/entities/auth/Role';
import { UserRole } from '../../../domain/entities/auth/UserRole';
import { RecordStatus } from '../../../domain/enums/RecordStatus';
import { NotFoundException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TelegramLink } from '../../../domain/entities/agent/TelegramLink';
import { ITelegramLinkRepository } from '../../../domain/repositories/telegram/ITelegramLinkRepository';

@Injectable()
export class TelegramLinkRepository
  implements ITelegramLinkRepository
{
  constructor(
    @InjectRepository(TelegramLink)
    private readonly repository:
      Repository<TelegramLink>,
  ) {}

  async findByTelegramUserId(
    telegramUserId: string,
  ): Promise<TelegramLink | null> {
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
  ): Promise<TelegramLink | null> {
    return this.repository.findOne({
      where: {
        userId,
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

  async createUserWithLink(user: User, link: TelegramLink): Promise<TelegramLink> {
    return this.repository.manager.transaction(async manager => {
      const saved = await manager.save(User, user);
      link.userId = saved.id;
      return manager.save(TelegramLink, link);
    });
  }

  async assignInitialRole(telegramUserId: string, roleName: string): Promise<string> {
    return this.repository.manager.transaction(async manager => {
      const link = await manager.findOne(TelegramLink, { where: { telegramUserId } });
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
    entity: TelegramLink,
  ): Promise<TelegramLink> {
    return this.repository.save(
      entity,
    );
  }
}