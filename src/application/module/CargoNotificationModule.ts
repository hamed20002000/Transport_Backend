import { jwtVerifyOnlyOptions } from '../../auth/jwtKeys';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CargoAlertFilter } from '../../domain/entities/notification/CargoAlertFilter';
import { CargoListing } from '../../domain/entities/notification/CargoListing';
import { CargoNotification } from '../../domain/entities/notification/CargoNotification';
import { CargoAlertFilterRepository } from '../../infrastructure/repositories/notification/cargoAlertFilter.repository';
import { CargoAudienceRepository } from '../../infrastructure/repositories/notification/cargoAudience.repository';
import { CargoListingRepository } from '../../infrastructure/repositories/notification/cargoListing.repository';
import { CargoNotificationRepository } from '../../infrastructure/repositories/notification/cargoNotification.repository';
import {
  CargoAlertFilterController,
  CargoListingController,
  CargoNotificationController,
} from '../../presentation/controllers/notification/cargo-notification.controller';
import { CargoAlertFilterService } from '../../services/notification/cargoAlertFilter.service';
import { CargoDeliveryRetryWorker } from '../../services/notification/cargoDeliveryRetryWorker.service';
import { CargoEventConsumer } from '../../services/notification/cargoEventConsumer.service';
import { CargoListingService } from '../../services/notification/cargoListing.service';
import { CargoNotificationService } from '../../services/notification/cargoNotification.service';
import { NotificationsGateway } from '../../services/notification/notifications.gateway';
import { ChannelMembershipNotifier } from '../../services/notification/channelMembership.service';
import { ChannelMembershipConsumer } from '../../services/notification/channelMembershipConsumer.service';
import { WhatsappModule } from '../services/agent/appModule/whatsapp.module';
import { RabbitMqModule } from './RabbitMqModule';
import { SubscriptionModule } from './SubscriptionModule';
import { TelegramModule } from './TelegramModule';
import { CompanyCargoTools } from '../../services/notification/companyCargoTools';
import { CompanyFilterTools } from '../../services/notification/companyFilterTools';

/**
 * پیام‌های «بار جدید» را از RabbitMQ می‌خواند و به شرکت‌هایی که کانال را ثبت
 * کرده‌اند پیشنهاد می‌دهد؛ شرکت می‌تواند بار را به نام خودش برای راننده‌ها منتشر
 * کند. همه‌ی اعلان‌ها از طریق وب (Socket.IO)، تلگرام و واتساپ می‌روند.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CargoNotification, CargoAlertFilter, CargoListing]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // فقط بررسی توکن socket -- کلید عمومی RS256
      useFactory: (configService: ConfigService) => jwtVerifyOnlyOptions(configService),
    }),
    RabbitMqModule,
    SubscriptionModule,
    TelegramModule,
    WhatsappModule,
  ],
  controllers: [CargoNotificationController, CargoListingController, CargoAlertFilterController],
  providers: [
    CargoNotificationRepository,
    CargoAlertFilterRepository,
    CargoListingRepository,
    CargoAudienceRepository,
    CargoAlertFilterService,
    CargoNotificationService,
    CargoListingService,
    NotificationsGateway,
    CargoEventConsumer,
    CargoDeliveryRetryWorker,
    ChannelMembershipNotifier,
    ChannelMembershipConsumer,
    // ابزارهای agent برای بارها و فیلترهای شرکت
    CompanyCargoTools,
    CompanyFilterTools,
  ],
})
export class CargoNotificationModule {}
