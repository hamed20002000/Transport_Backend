import { Injectable } from '@nestjs/common';

import { TelegramSessionState } from 'src/domain/enums/telegram';
import { TelegramSession } from 'src/domain/interfaces/telegram.interface';

@Injectable()
export class TelegramSessionService {
  private readonly sessions =
    new Map<string, TelegramSession>();

  get(
    telegramUserId: string,
  ): TelegramSession | null {
    return (
      this.sessions.get(telegramUserId) ??
      null
    );
  }

  getOrCreate(
    telegramUserId: string,
  ): TelegramSession {
    let session =
      this.sessions.get(
        telegramUserId,
      );

    if (!session) {
      session = {
        state:
          TelegramSessionState.Idle,
      };

      this.sessions.set(
        telegramUserId,
        session,
      );
    }

    return session;
  }

  set(
    telegramUserId: string,
    session: TelegramSession,
  ): void {
    this.sessions.set(
      telegramUserId,
      session,
    );
  }

  update(
    telegramUserId: string,
    values: Partial<TelegramSession>,
  ): TelegramSession {
    const session =
      this.getOrCreate(
        telegramUserId,
      );

    Object.assign(
      session,
      values,
    );

    return session;
  }

  reset(
    telegramUserId: string,
  ): TelegramSession {
    const session: TelegramSession = {
      state:
        TelegramSessionState.Idle,
    };

    this.sessions.set(
      telegramUserId,
      session,
    );

    return session;
  }

  delete(
    telegramUserId: string,
  ): void {
    this.sessions.delete(
      telegramUserId,
    );
  }
}