import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InviteUsedEvent, REDIS_CHANNELS } from '../redis/redis.keys';
import { RedisService } from '../redis/redis.service';
import { INVITE_USED_SOCKET_EVENT, NotificationsGateway } from './notifications.gateway';

/**
 * An invited driver, factory or company came in (markInvitesUsed, from any way in): the inviter's open page hears of
 * it at once, so its invite list says «وارد شد» without a refresh.
 */
@Injectable()
export class InviteUsageNotifier implements OnModuleInit {
  private readonly logger = new Logger(InviteUsageNotifier.name);

  constructor(
    private readonly redis: RedisService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.subscribe(REDIS_CHANNELS.inviteUsed, (message) => this.handle(message));
    } catch (error) {
      this.logger.warn(`Could not listen for used invites: ${(error as Error).message}`);
    }
  }

  handle(message: string): void {
    try {
      const event = JSON.parse(message) as InviteUsedEvent;
      this.gateway.sendToUser(event.inviterUserId, INVITE_USED_SOCKET_EVENT, { kind: event.kind, userId: event.inviteeUserId });
    } catch (error) {
      this.logger.warn(`Used invite notice failed: ${(error as Error).message}`);
    }
  }
}
