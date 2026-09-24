import { User } from '../../entities/auth/User';
import { TelegramLink } from '../../entities/agent/TelegramLink';

export interface ITelegramLinkRepository {
  findByTelegramUserId(
    telegramUserId: string,
  ): Promise<TelegramLink | null>;

  findByUserId(
    userId: string,
  ): Promise<TelegramLink | null>;

  createUserWithLink(user: User, link: TelegramLink): Promise<TelegramLink>;

  assignInitialRole(telegramUserId: string, roleName: string): Promise<string>;

  save(
    entity: TelegramLink,
  ): Promise<TelegramLink>;
}