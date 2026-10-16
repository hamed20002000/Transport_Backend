import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserMarketPreference } from '../../domain/entities/market/UserMarketPreference';
import { MARKET_CATALOG, MAX_MARKET_SYMBOLS, validMarketSymbols } from './marketPrice.service';

const CATALOG_SYMBOLS = new Set<string>(MARKET_CATALOG.map((item) => item.symbol));

/** ارزها و طلای انتخابی هر کاربر برای نوار قیمت (پنل وب و پیام قیمت ربات‌ها). */
@Injectable()
export class MarketPreferenceService {
  constructor(@InjectRepository(UserMarketPreference) private readonly preferences: Repository<UserMarketPreference>) {}

  /** انتخاب کاربر، یا پیش‌فرض؛ بدون کاربر (مثلاً چت ناشناس) هم پیش‌فرض. */
  async symbolsOf(userId?: string | null): Promise<string[]> {
    if (!userId) return validMarketSymbols(null);
    const preference = await this.preferences.findOne({ where: { userId } });
    return validMarketSymbols(preference?.symbols);
  }

  async set(userId: string, symbols: string[]): Promise<string[]> {
    const unique = [...new Set(symbols)];
    if (!unique.length || unique.length > MAX_MARKET_SYMBOLS) {
      throw new BadRequestException(`Choose between 1 and ${MAX_MARKET_SYMBOLS} items.`);
    }
    const unknown = unique.filter((symbol) => !CATALOG_SYMBOLS.has(symbol));
    if (unknown.length) throw new BadRequestException(`Unknown market symbols: ${unknown.join(', ')}`);
    await this.preferences.upsert({ userId, symbols: unique }, ['userId']);
    return unique;
  }

  /**
   * افزودن یا برداشتن یک قلم (دکمه‌های ربات). پیش‌فرض خودش ۶ قلم است؛ اگر جا پر باشد قلم
   * تازه جای آخرین قلم را می‌گیرد (replaced). null یعنی نماد ناشناخته یا برداشتن آخرین قلم.
   */
  async toggle(userId: string, symbol: string): Promise<{ symbols: string[]; replaced?: string } | null> {
    if (!CATALOG_SYMBOLS.has(symbol)) return null;
    const current = await this.symbolsOf(userId);
    if (current.includes(symbol)) {
      const next = current.filter((item) => item !== symbol);
      return next.length ? { symbols: await this.set(userId, next) } : null;
    }
    if (current.length < MAX_MARKET_SYMBOLS) return { symbols: await this.set(userId, [...current, symbol]) };
    const replaced = current[current.length - 1];
    return { symbols: await this.set(userId, [...current.slice(0, -1), symbol]), replaced };
  }
}
