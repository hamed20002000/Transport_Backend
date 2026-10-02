import { CARGO_EVENTS_EXCHANGE } from './cargoEvents';

/**
 * قرارداد رویداد تغییر وضعیت عضویت که tarabari_backend منتشر می‌کند
 * (ChannelMembershipService -> outbox -> exchange cargo_events). هر تغییری در
 * payload آنجا باید اینجا هم اعمال شود.
 */
export { CARGO_EVENTS_EXCHANGE };

export const CHANNEL_MEMBERSHIP_CHANGED = 'channel.membership.changed';

export const CHANNEL_MEMBERSHIP_QUEUE = 'transport.channel-membership';

export const CHANNEL_MEMBERSHIP_DLQ = `${CHANNEL_MEMBERSHIP_QUEUE}.dlq`;

export type ChannelMembershipStatus = 'queued' | 'pending' | 'joined' | 'failed' | 'removed';

// باید با CHANNEL_PLATFORMS در tarabari_backend یکی باشد -- رویداد پلتفرم ناشناخته رد می‌شود.
export const CHANNEL_PLATFORMS = ['whatsapp', 'telegram', 'bale', 'rubika'] as const;
export type ChannelPlatform = (typeof CHANNEL_PLATFORMS)[number];

export interface ChannelMembershipChangedEvent {
  eventId: string;
  platform: ChannelPlatform;
  channelId: string;
  identifier: string | null;
  label: string | null;
  type: string;
  status: ChannelMembershipStatus;
  previousStatus: ChannelMembershipStatus | null;
  reason: string | null;
  ownerUserIds: string[];
  occurredAt: string;
}
