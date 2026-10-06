import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionOrder } from '../../domain/entities/subscription/SubscriptionOrder';
import { SubscriptionOrderController } from '../../presentation/controllers/admin/subscription-order.controller';
import { MessengerBotModule } from './MessengerBotModule';
import { SubscriptionModule } from './SubscriptionModule';

/**
 * تأیید/رد رسید خرید اشتراک توسط ادمین. جدا از SubscriptionModule چون
 * نتیجه را با ربات به کاربر می‌فرستد و MessengerBotModule خودش به
 * SubscriptionModule وابسته است.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionOrder]), SubscriptionModule, MessengerBotModule],
  controllers: [SubscriptionOrderController],
})
export class SubscriptionAdminModule {}
