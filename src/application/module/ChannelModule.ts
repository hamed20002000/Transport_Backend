import { Module } from '@nestjs/common';

import { CompanyChannelsDialog } from '../../services/channel/companyChannelsDialog';
import { CompanyChannelsService } from '../../services/channel/companyChannels.service';
import { TarabariChannelsClient } from '../../services/channel/tarabariChannels.client';
import { RedisModule } from './RedisModule';
import { SubscriptionModule } from './SubscriptionModule';
import { UserModule } from './UserModule';
import { CompanyChannelTools } from '../../services/channel/companyChannelTools';

/**
 * گروه/کانال‌های واتساپ و تلگرامی که کاربر برای دریافت بار ثبت می‌کند
 * (ذخیره در tarabari_backend). مشترک بین ربات تلگرام و واتساپ.
 */
@Module({
  imports: [RedisModule, SubscriptionModule, UserModule],
  providers: [TarabariChannelsClient, CompanyChannelsService, CompanyChannelsDialog, CompanyChannelTools],
  exports: [CompanyChannelsService, CompanyChannelsDialog],
})
export class ChannelModule {}
