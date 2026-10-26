import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { CargoAudienceRepository } from '../../infrastructure/repositories/notification/cargoAudience.repository';
import { ProfileContactChangedEvent, REDIS_CHANNELS } from '../redis/redis.keys';
import { RedisService } from '../redis/redis.service';
import { CargoListingService } from './cargoListing.service';
import { CARGO_LISTING_CONTACT_SOCKET_EVENT, NotificationsGateway } from './notifications.gateway';

// loads written in one socket event; a company with more changed loads sends the newest ones (the rest show the
// new contact on the next fetch)
const MAX_SENT = 300;

/**
 * A company changed the name or phone in its profile (UserService.updateProfile): its loads already announced
 * show the new ones too (CargoListingService.refreshPublisherContact), and the pages open right now change in
 * place. The event carries only id, name and phones of the changed loads, so a thousand drivers on the loads
 * page cost one small message each and no request back to the server.
 */
@Injectable()
export class CargoContactSync implements OnModuleInit {
  private readonly logger = new Logger(CargoContactSync.name);

  constructor(
    private readonly redis: RedisService,
    private readonly audience: CargoAudienceRepository,
    private readonly listings: CargoListingService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.subscribe(REDIS_CHANNELS.profileContactChanged, (message) => void this.handle(message));
    } catch (error) {
      this.logger.warn(`Could not listen for profile contact changes: ${(error as Error).message}`);
    }
  }

  async handle(message: string): Promise<void> {
    try {
      const event = JSON.parse(message) as ProfileContactChangedEvent;
      const [before, after] = await Promise.all([
        this.audience.findPublisherContact(event.userId, event.before),
        this.audience.findPublisherContact(event.userId),
      ]);
      // a second server instance finds nothing left to change and sends nothing
      const changed = await this.listings.refreshPublisherContact(event.userId, before, after);
      if (!changed.length) return;

      const items = changed
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, MAX_SENT)
        .map((listing) => ({ id: listing.id, companyName: listing.companyName ?? null, contactPhones: listing.contactPhones }));
      this.gateway.sendToRoles(['DRIVER'], CARGO_LISTING_CONTACT_SOCKET_EVENT, { items });
      this.gateway.sendToUser(event.userId, CARGO_LISTING_CONTACT_SOCKET_EVENT, { items });
      this.logger.log(`Profile contact of ${event.userId} changed: ${changed.length} load(s) updated`);
    } catch (error) {
      this.logger.warn(`Profile contact update failed: ${(error as Error).message}`);
    }
  }
}
