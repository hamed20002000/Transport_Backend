import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import { RedisService } from '../redis/redis.service';

// داده‌ی رایگان و بدون کلید iran-market (از TGJU)؛ هر ۳۰ دقیقه منتشر می‌شود.
const DEFAULT_SOURCE_URL = 'https://raw.githubusercontent.com/iran-market/iran-market.github.io/main/data/latest-toman.json';
export const MARKET_REFRESH_MINUTES = 30;
// اگر منبع چند ساعت در دسترس نبود، آخرین قیمت‌ها همچنان نمایش داده می‌شوند (با برچسب زمان)
const SNAPSHOT_TTL_SECONDS = 24 * 3600;
const MEMORY_TTL_MS = 60_000;

/** نمادهایی که به راننده و شرکت نشان داده می‌شوند، به همین ترتیب. */
export const MARKET_SYMBOLS = [
  { symbol: 'USD_IRR_FREE', label: 'دلار', icon: '💵' },
  { symbol: 'EUR_IRR_FREE', label: 'یورو', icon: '💶' },
  { symbol: 'TRY_IRR_FREE', label: 'لیر ترکیه', icon: '🇹🇷' },
  { symbol: 'IQD_IRR_FREE', label: 'دینار عراق', icon: '🇮🇶' },
  { symbol: 'GOLD_18K_IRR', label: 'طلای ۱۸ عیار (گرم)', icon: '🟡' },
  { symbol: 'COIN_EMAMI_IRR', label: 'سکه امامی', icon: '🪙' },
] as const;

export interface MarketQuote {
  symbol: string;
  label: string;
  icon: string;
  // تومان
  price: number;
  changePct: number | null;
  // زمان آخرین معامله در منبع
  updatedAt: string;
  updatedAtJalali: string | null;
}

export interface MarketSnapshot {
  quotes: MarketQuote[];
  // آخرین بار که از منبع خوانده شد
  fetchedAt: string;
  refreshMinutes: number;
}

interface SourceItem {
  symbol?: string;
  price?: number | null;
  change_pct?: number | null;
  timestamp?: string | null;
  timestamp_jalali?: string | null;
}

/**
 * قیمت دلار، یورو، لیر، دینار، طلا و سکه. فقط یک نمونه‌ی برنامه هر ۳۰ دقیقه از منبع
 * می‌خواند (قفل Redis) و بقیه و همه‌ی کاربران همان نسخه‌ی Redis را می‌بینند.
 */
@Injectable()
export class MarketPriceService {
  private readonly logger = new Logger(MarketPriceService.name);
  private memory?: { snapshot: MarketSnapshot; readAt: number };

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly redis: RedisService,
  ) {}

  /** آخرین قیمت‌ها؛ اگر هنوز چیزی خوانده نشده یک بار از منبع می‌خواند. */
  async current(): Promise<MarketSnapshot | null> {
    if (this.memory && Date.now() - this.memory.readAt < MEMORY_TTL_MS) return this.memory.snapshot;
    const cached = await this.redis.get(RedisService.key('marketPrices')).catch(() => null);
    if (cached) return this.remember(JSON.parse(cached) as MarketSnapshot);
    return (await this.refresh()) ?? this.memory?.snapshot ?? null;
  }

  /**
   * خواندن از منبع. null یعنی نمونه‌ی دیگری همین الان خوانده یا منبع در دسترس نبود؛
   * در هر دو حالت قیمت‌های قبلی سر جایشان می‌مانند.
   */
  async refresh(): Promise<MarketSnapshot | null> {
    const lockKey = RedisService.key('marketRefreshLock');
    const owner = randomUUID();
    const locked = await this.redis.setIfAbsent(lockKey, owner, MARKET_REFRESH_MINUTES * 60 - 120).catch(() => true);
    if (!locked) return null;
    try {
      const url = this.config.get<string>('MARKET_PRICES_URL')?.trim() || DEFAULT_SOURCE_URL;
      const { data } = await firstValueFrom(this.http.get<unknown>(url, { timeout: 20000, maxRedirects: 2 }));
      const snapshot = parseSnapshot(data);
      if (!snapshot.quotes.length) throw new Error('No known symbols in response');
      await this.redis.set(RedisService.key('marketPrices'), JSON.stringify(snapshot), SNAPSHOT_TTL_SECONDS).catch(() => undefined);
      return this.remember(snapshot);
    } catch (error: unknown) {
      // دو دقیقه بعد دوباره امتحان می‌شود، نه نیم ساعت بعد؛ ولی نه پشت‌سرهم با هر درخواست کاربر.
      this.logger.warn(`Market prices refresh failed: ${(error as Error).message}`);
      await this.redis.deleteIfValue(lockKey, owner).catch(() => undefined);
      await this.redis.setIfAbsent(lockKey, owner, 120).catch(() => undefined);
      return null;
    }
  }

  private remember(snapshot: MarketSnapshot): MarketSnapshot {
    this.memory = { snapshot, readAt: Date.now() };
    return snapshot;
  }
}

/** latest-toman.json: data.categories.{currency,gold,coin,...} هر کدام آرایه‌ی نمادها. */
export function parseSnapshot(body: unknown, now = new Date()): MarketSnapshot {
  const categories = (body as { data?: { categories?: Record<string, unknown> } })?.data?.categories ?? {};
  const bySymbol = new Map<string, SourceItem>();
  for (const items of Object.values(categories)) {
    if (!Array.isArray(items)) continue;
    for (const item of items as SourceItem[]) if (item?.symbol) bySymbol.set(item.symbol, item);
  }
  const quotes = MARKET_SYMBOLS.flatMap(({ symbol, label, icon }) => {
    const item = bySymbol.get(symbol);
    if (typeof item?.price !== 'number' || !(item.price > 0)) return [];
    return [
      {
        symbol,
        label,
        icon,
        price: item.price,
        changePct: typeof item.change_pct === 'number' ? item.change_pct : null,
        updatedAt: item.timestamp ?? now.toISOString(),
        updatedAtJalali: item.timestamp_jalali ?? null,
      },
    ];
  });
  return { quotes, fetchedAt: now.toISOString(), refreshMinutes: MARKET_REFRESH_MINUTES };
}

const faNumber = (value: number, digits = 0) => value.toLocaleString('fa-IR', { maximumFractionDigits: digits });

/** متن پیام قیمت‌ها برای ربات‌ها و واتساپ. */
export function formatSnapshot(snapshot: MarketSnapshot | null, live: boolean): string {
  if (!snapshot?.quotes.length) return '💰 قیمت‌ها فعلاً در دسترس نیست. چند دقیقه‌ی دیگر دوباره امتحان کنید.';
  const latest = Math.max(...snapshot.quotes.map((quote) => Date.parse(quote.updatedAt)));
  const lines = snapshot.quotes.map((quote) => {
    const change = quote.changePct === null || quote.changePct === 0 ? '' : ` ${quote.changePct > 0 ? '🔺' : '🔻'}${faNumber(Math.abs(quote.changePct), 2)}٪`;
    // نمادی که از بقیه یک روز عقب‌تر است (مثلاً دینار) تاریخ خودش را نشان می‌دهد
    const old = latest - Date.parse(quote.updatedAt) > 24 * 3600_000 && quote.updatedAtJalali ? ` (${toFaDigits(quote.updatedAtJalali.split(' ')[0])})` : '';
    return `${quote.icon} ${quote.label}: ${faNumber(quote.price, quote.price < 1000 ? 1 : 0)}${change}${old}`;
  });
  const time = new Date(latest).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' });
  return [
    '💰 قیمت‌های بازار (تومان)',
    '',
    ...lines,
    '',
    `🕒 آخرین قیمت: ${time}`,
    live
      ? `🔄 این پیام تا ۴۸ ساعت هر ${faNumber(snapshot.refreshMinutes)} دقیقه خودکار به‌روز می‌شود.`
      : `🔄 قیمت‌ها هر ${faNumber(snapshot.refreshMinutes)} دقیقه به‌روز می‌شوند.`,
  ].join('\n');
}

const toFaDigits = (text: string) => text.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
