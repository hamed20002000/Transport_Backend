import { jwtVerifyOnlyOptions } from '../../auth/jwtKeys';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CargoAlertFilter } from '../../domain/entities/notification/CargoAlertFilter';
import { CargoListing } from '../../domain/entities/notification/CargoListing';
import { CargoNotification } from '../../domain/entities/notification/CargoNotification';
import { CargoRequest } from '../../domain/entities/notification/CargoRequest';
import { DriverProfile } from '../../domain/entities/driver/DriverProfile';
import { DriverProfileService } from '../../services/driver/driverProfile.service';
import { DriverLocation } from '../../domain/entities/notification/DriverLocation';
import { DriverLocationLog } from '../../domain/entities/notification/DriverLocationLog';
import { CargoAlertFilterRepository } from '../../infrastructure/repositories/notification/cargoAlertFilter.repository';
import { CargoAudienceRepository } from '../../infrastructure/repositories/notification/cargoAudience.repository';
import { CargoListingRepository } from '../../infrastructure/repositories/notification/cargoListing.repository';
import { CargoNotificationRepository } from '../../infrastructure/repositories/notification/cargoNotification.repository';
import {
  CargoRequestRepository,
  DriverLocationRepository,
} from '../../infrastructure/repositories/notification/cargoRequest.repository';
import {
  CargoAlertFilterController,
  CargoListingController,
  CargoNotificationController,
} from '../../presentation/controllers/notification/cargo-notification.controller';
import { DriverController } from '../../presentation/controllers/notification/driver.controller';
import { CargoAlertFilterService } from '../../services/notification/cargoAlertFilter.service';
import { CargoDeliveryRetryWorker } from '../../services/notification/cargoDeliveryRetryWorker.service';
import { CargoOfferExpiryWorker } from '../../services/notification/cargoOfferExpiryWorker.service';
import { CargoEventConsumer } from '../../services/notification/cargoEventConsumer.service';
import { CargoListingService } from '../../services/notification/cargoListing.service';
import { CargoNotificationService } from '../../services/notification/cargoNotification.service';
import { NotificationsGateway } from '../../services/notification/notifications.gateway';
import { ChannelMembershipNotifier } from '../../services/notification/channelMembership.service';
import { ChannelMembershipConsumer } from '../../services/notification/channelMembershipConsumer.service';
import { WhatsappModule } from '../services/agent/appModule/whatsapp.module';
import { RabbitMqModule } from './RabbitMqModule';
import { SubscriptionModule } from './SubscriptionModule';
import { MessengerBotModule } from './MessengerBotModule';
import { RedisModule } from './RedisModule';
import { UserModule } from './UserModule';
import { CargoDialog } from '../../services/notification/cargoDialog';
import { CargoTripService } from '../../services/notification/cargoTrip.service';
import { TripDialog } from '../../services/notification/tripDialog';
import { TextToSpeechService } from '../../services/speech/textToSpeech.service';
import { WhatsappDialogBridge } from '../../services/notification/whatsappDialogBridge';
import { CargoInsightService } from '../../services/notification/cargoInsight.service';
import { RoutingModule } from './RoutingModule';
import { CompanyCargoTools } from '../../services/notification/companyCargoTools';
import { CompanyFilterTools } from '../../services/notification/companyFilterTools';
import { DriverCargoTools } from '../../services/notification/driverCargoTools';
import { DriverProfileTools } from '../../services/driver/driverProfileTools';

/**
 * پیام‌های «بار جدید» را از RabbitMQ می‌خواند و به شرکت‌هایی که کانال را ثبت
 * کرده‌اند پیشنهاد می‌دهد؛ شرکت می‌تواند بار را به نام خودش برای راننده‌ها منتشر
 * کند. همه‌ی اعلان‌ها از طریق وب (Socket.IO)، تلگرام و واتساپ می‌روند.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CargoNotification, CargoAlertFilter, CargoListing, CargoRequest, DriverLocation, DriverLocationLog, DriverProfile]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // فقط بررسی توکن socket -- کلید عمومی RS256
      useFactory: (configService: ConfigService) => jwtVerifyOnlyOptions(configService),
    }),
    RabbitMqModule,
    SubscriptionModule,
    MessengerBotModule,
    WhatsappModule,
    RedisModule,
    UserModule,
    // مسیر، مسافت، سوخت و جایگاه‌های سوخت برای جزئیات بار راننده
    RoutingModule,
  ],
  controllers: [CargoNotificationController, CargoListingController, CargoAlertFilterController, DriverController],
  providers: [
    CargoNotificationRepository,
    CargoAlertFilterRepository,
    CargoListingRepository,
    CargoAudienceRepository,
    CargoRequestRepository,
    DriverLocationRepository,
    CargoAlertFilterService,
    // درخواست راننده، سفر فعال و موقعیت راننده
    CargoTripService,
    // پروفایل، مدارک و عکس‌های راننده
    DriverProfileService,
    CargoInsightService,
    CargoNotificationService,
    CargoListingService,
    NotificationsGateway,
    CargoEventConsumer,
    CargoDeliveryRetryWorker,
    // بار سپرده‌شده‌ای که راننده تا پایان مهلت تأیید نکرد
    CargoOfferExpiryWorker,
    ChannelMembershipNotifier,
    ChannelMembershipConsumer,
    // ابزارهای agent برای بارها و فیلترهای شرکت
    CompanyCargoTools,
    CompanyFilterTools,
    // ابزارهای agent برای بارها و پروفایل راننده
    DriverCargoTools,
    DriverProfileTools,
    // دکمه‌های بار در ربات‌ها؛ خودش را در BotDialogRegistry ثبت می‌کند
    CargoDialog,
    // درخواست‌ها/سفر/بار برگشتی راننده و درخواست رانندگان/سفرهای فعال شرکت
    TripDialog,
    // متن به صدا (Piper) برای خواندن جایگاه‌ها و ...
    TextToSpeechService,
    // همین گفتگوها در واتساپ با گزینه‌های شماره‌دار
    WhatsappDialogBridge,
  ],
})
export class CargoNotificationModule {}
