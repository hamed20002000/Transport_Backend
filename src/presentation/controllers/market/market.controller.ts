import { Body, Controller, Get, Put, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { MarketPreferenceService } from 'src/services/market/marketPreference.service';
import { MARKET_CATALOG, MAX_MARKET_SYMBOLS, MarketPriceService, pickQuotes } from 'src/services/market/marketPrice.service';

type AuthRequest = { user?: JwtPayload };

function currentUserId(request: AuthRequest): string {
  if (!request.user?.userId) throw new UnauthorizedException();
  return request.user.userId;
}

class MarketPreferencesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_MARKET_SYMBOLS) @IsString({ each: true })
  symbols!: string[];
}

/** قیمت ارز و طلا برای نوار قیمت پنل راننده و شرکت؛ هر کاربر قلم‌های خودش را می‌بیند. */
@Controller('api/market')
@UseGuards(JwtAuthGuard)
export class MarketController {
  constructor(
    private readonly prices: MarketPriceService,
    private readonly preferences: MarketPreferenceService,
  ) {}

  // فقط قلم‌های انتخابی کاربر، به ترتیب انتخابش
  @Get('prices')
  async current(@Req() request: AuthRequest) {
    const snapshot = await this.prices.current();
    if (!snapshot) throw new ServiceUnavailableException('Market prices are not available yet.');
    return pickQuotes(snapshot, await this.preferences.symbolsOf(currentUserId(request)));
  }

  // همه‌ی قلم‌های قابل انتخاب با قیمت فعلی (اگر منبع داشته باشد) و انتخاب فعلی کاربر
  @Get('catalog')
  async catalog(@Req() request: AuthRequest) {
    const snapshot = await this.prices.current();
    const quotes = new Map(snapshot?.quotes.map((quote) => [quote.symbol, quote]) ?? []);
    return {
      items: MARKET_CATALOG.map((item) => ({ ...item, price: quotes.get(item.symbol)?.price ?? null })),
      selected: await this.preferences.symbolsOf(currentUserId(request)),
      max: MAX_MARKET_SYMBOLS,
    };
  }

  @Put('preferences')
  async save(@Req() request: AuthRequest, @Body() dto: MarketPreferencesDto) {
    return { selected: await this.preferences.set(currentUserId(request), dto.symbols) };
  }
}
