import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MarketController } from '../../presentation/controllers/market/market.controller';
import { MarketPriceService } from '../../services/market/marketPrice.service';
import { RedisModule } from './RedisModule';

/** قیمت ارز و طلا (iran-market، هر ۳۰ دقیقه)؛ ربات‌ها از MessengerBotModule همین سرویس را می‌خوانند. */
@Module({
  imports: [HttpModule, ConfigModule, RedisModule],
  controllers: [MarketController],
  providers: [MarketPriceService],
  exports: [MarketPriceService],
})
export class MarketModule {}
