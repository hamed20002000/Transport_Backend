import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserMarketPreference } from '../../domain/entities/market/UserMarketPreference';
import { MarketController } from '../../presentation/controllers/market/market.controller';
import { MarketPreferenceService } from '../../services/market/marketPreference.service';
import { MarketPriceService } from '../../services/market/marketPrice.service';
import { RedisModule } from './RedisModule';

/**
 * قیمت ارز و طلا (iran-market، هر ۳۰ دقیقه) و قلم‌های انتخابی هر کاربر؛ ربات‌ها از
 * MessengerBotModule همین سرویس‌ها را می‌خوانند.
 */
@Module({
  imports: [HttpModule, ConfigModule, RedisModule, TypeOrmModule.forFeature([UserMarketPreference])],
  controllers: [MarketController],
  providers: [MarketPriceService, MarketPreferenceService],
  exports: [MarketPriceService, MarketPreferenceService],
})
export class MarketModule {}
