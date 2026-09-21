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

  async save(
    entity: TelegramLink,
  ): Promise<TelegramLink> {
    return this.repository.save(
      entity,
    );
  }
}