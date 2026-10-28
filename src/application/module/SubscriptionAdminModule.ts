import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionOrder } from '../../domain/entities/subscription/SubscriptionOrder';
import { PaymentReceipt } from '../../domain/entities/subscription/PaymentReceipt';
import { SubscriptionOrderController } from '../../presentation/controllers/admin/subscription-order.controller';
import { AdminStatsController } from '../../presentation/controllers/admin/admin-stats.controller';
import { MessengerBotModule } from './MessengerBotModule';
import { SubscriptionModule } from './SubscriptionModule';
import { RedisModule } from './RedisModule';
import { ReceiptAccessService } from '../../services/subscription/receiptAccess.service';
import { CompanyFeatureAdminController } from '../../presentation/controllers/admin/company-feature.controller';
import { CompanyFeatureModule } from './CompanyFeatureModule';
import { BrokerAccessAdminController } from '../../presentation/controllers/admin/broker-access.controller';

/**
 * تأیید/رد رسید خرید اشتراک توسط ادمین. جدا از SubscriptionModule چون
 * نتیجه را با ربات به کاربر می‌فرستد و MessengerBotModule خودش به
 * SubscriptionModule وابسته است.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionOrder, PaymentReceipt]), SubscriptionModule, MessengerBotModule, RedisModule, CompanyFeatureModule],
  controllers: [SubscriptionOrderController, AdminStatsController, CompanyFeatureAdminController, BrokerAccessAdminController],
  providers: [ReceiptAccessService],
})
export class SubscriptionAdminModule {}
