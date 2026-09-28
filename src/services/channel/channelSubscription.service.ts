import { Inject, Injectable } from '@nestjs/common';

import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { SUBSCRIPTION_REPOSITORY, USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { ISubscriptionRepository } from 'src/domain/repositories/subscription/ISubscriptionRepository';
import { ChannelPlatform, MonitoredChannel, TarabariChannelsClient } from './tarabariChannels.client';

export type ChannelAccess = 'ok' | 'notCompany' | 'noSubscription';

// شناسه‌ی ثبت‌کننده‌های دیگرِ همان گروه/کانال به کاربر نشان داده نمی‌شود.
export type UserChannel = Omit<MonitoredChannel, 'ownerUserIds'>;

const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];

/**
 * قوانین کسب‌وکار گروه/کانال‌های کاربر، مستقل از پیام‌رسان: فقط شرکت با
 * اشتراک فعال، و هر کاربر فقط لیست خودش. تلگرام و واتساپ هر دو از همین
 * سرویس استفاده می‌کنند.
 */
@Injectable()
export class ChannelSubscriptionService {
  constructor(
    private readonly tarabari: TarabariChannelsClient,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptions: ISubscriptionRepository,
  ) {}

  async checkAccess(userId: string): Promise<ChannelAccess> {
    const user = await this.users.findById(userId);
    const roles = user?.userRoles?.map((item) => item.role?.name).filter(Boolean) ?? [];
    if (!roles.some((role) => COMPANY_ROLES.includes(role))) return 'notCompany';
    return (await this.subscriptions.findActiveByUserId(userId)) ? 'ok' : 'noSubscription';
  }

  async list(userId: string): Promise<UserChannel[]> {
    return (await this.tarabari.list(userId)).map(toUserChannel);
  }

  async add(userId: string, link: string, label?: string) {
    const result = await this.tarabari.register(userId, link.trim(), label?.trim() || undefined);
    return { created: result.created, channel: toUserChannel(result.channel), warning: result.warning ?? null };
  }

  async remove(userId: string, platform: ChannelPlatform, id: string): Promise<void> {
    await this.tarabari.removeOwner(userId, platform, id);
  }
}

function toUserChannel({ ownerUserIds: _owners, ...channel }: MonitoredChannel): UserChannel {
  return channel;
}
