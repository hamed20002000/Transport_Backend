import { TelegramLink } from '../../entities/agent/TelegramLink';

export interface ITelegramLinkRepository {
  findByTelegramUserId(
    telegramUserId: string,
  ): Promise<TelegramLink | null>;

  findByUserId(
    userId: string,
  ): Promise<TelegramLink | null>;

  save(
    entity: TelegramLink,
  ): Promise<TelegramLink>;
}