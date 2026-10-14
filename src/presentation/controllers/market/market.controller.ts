import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { MarketPriceService } from 'src/services/market/marketPrice.service';

/** قیمت دلار، یورو، لیر، دینار، طلا و سکه برای نوار قیمت پنل راننده و شرکت. */
@Controller('api/market')
@UseGuards(JwtAuthGuard)
export class MarketController {
  constructor(private readonly prices: MarketPriceService) {}

  @Get('prices')
  async current() {
    const snapshot = await this.prices.current();
    if (!snapshot) throw new ServiceUnavailableException('Market prices are not available yet.');
    return snapshot;
  }
}
