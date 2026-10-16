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

/**
 * همه‌ی قلم‌هایی که کاربر می‌تواند برای نوار قیمت انتخاب کند: پول کشورهای مسیر بار
 * (ترکیه، عراق، ارمنستان، آذربایجان، گرجستان، ترکمنستان، افغانستان، پاکستان، …)،
 * ارزهای رایج و طلا و سکه. ترتیب همین ترتیب فهرست انتخاب است.
 */
export const MARKET_CATALOG = [
  { symbol: 'USD_IRR_FREE', label: 'دلار', icon: '💵' },
  { symbol: 'EUR_IRR_FREE', label: 'یورو', icon: '💶' },
  { symbol: 'TRY_IRR_FREE', label: 'لیر ترکیه', icon: '🇹🇷' },
  { symbol: 'IQD_IRR_FREE', label: 'دینار عراق', icon: '🇮🇶' },
  { symbol: 'AMD_IRR_FREE', label: 'درام ارمنستان', icon: '🇦🇲' },
  { symbol: 'AZN_IRR_FREE', label: 'منات آذربایجان', icon: '🇦🇿' },
  { symbol: 'GEL_IRR_FREE', label: 'لاری گرجستان', icon: '🇬🇪' },
  { symbol: 'TMT_IRR_FREE', label: 'منات ترکمنستان', icon: '🇹🇲' },
  { symbol: 'AFN_IRR_FREE', label: 'افغانی افغانستان', icon: '🇦🇫' },
  { symbol: 'PKR_IRR_FREE', label: 'روپیه پاکستان', icon: '🇵🇰' },
  { symbol: 'AED_IRR_FREE', label: 'درهم امارات', icon: '🇦🇪' },
  { symbol: 'RUB_IRR_FREE', label: 'روبل روسیه', icon: '🇷🇺' },
  { symbol: 'KZT_IRR_FREE', label: 'تنگه قزاقستان', icon: '🇰🇿' },
  { symbol: 'TJS_IRR_FREE', label: 'سامانی تاجیکستان', icon: '🇹🇯' },
  { symbol: 'UZS_IRR_FREE', label: 'سوم ازبکستان', icon: '🇺🇿' },
  { symbol: 'CNY_IRR_FREE', label: 'یوان چین', icon: '🇨🇳' },
  { symbol: 'SAR_IRR_FREE', label: 'ریال عربستان', icon: '🇸🇦' },
  { symbol: 'KWD_IRR_FREE', label: 'دینار کویت', icon: '🇰🇼' },
  { symbol: 'QAR_IRR_FREE', label: 'ریال قطر', icon: '🇶🇦' },
  { symbol: 'OMR_IRR_FREE', label: 'ریال عمان', icon: '🇴🇲' },
  { symbol: 'GBP_IRR_FREE', label: 'پوند انگلیس', icon: '🇬🇧' },
  { symbol: 'GOLD_18K_IRR', label: 'طلای ۱۸ عیار (گرم)', icon: '🟡' },
  { symbol: 'COIN_EMAMI_IRR', label: 'سکه امامی', icon: '🪙' },
  { symbol: 'COIN_BAHAR_IRR', label: 'سکه بهار آزادی', icon: '🪙' },
  { symbol: 'COIN_HALF_IRR', label: 'نیم سکه', icon: '🪙' },
  { symbol: 'COIN_QUARTER_IRR', label: 'ربع سکه', icon: '🪙' },
] as const;

/** پیش‌فرض نوار قیمت (کاربری که انتخاب نکرده)؛ کاربر تا MAX_MARKET_SYMBOLS قلم انتخاب می‌کند. */
export const DEFAULT_MARKET_SYMBOLS: string[] = ['USD_IRR_FREE', 'EUR_IRR_FREE', 'TRY_IRR_FREE', 'IQD_IRR_FREE', 'GOLD_18K_IRR', 'COIN_EMAMI_IRR'];
export const MAX_MARKET_SYMBOLS = 6;
const CATALOG_SYMBOLS = new Set<string>(MARKET_CATALOG.map((item) => item.symbol));

/** فقط نمادهای فهرست، بی‌تکرار و حداکثر MAX_MARKET_SYMBOLS؛ خالی یعنی پیش‌فرض. */
export function validMarketSymbols(symbols: readonly string[] | null | undefined): string[] {
  const valid = [...new Set((symbols ?? []).filter((symbol) => CATALOG_SYMBOLS.has(symbol)))].slice(0, MAX_MARKET_SYMBOLS);
  return valid.length ? valid : [...DEFAULT_MARKET_SYMBOLS];
}

/** قیمت‌های انتخابی کاربر به ترتیب انتخابش؛ قلمی که منبع قیمت ندارد کنار می‌رود. */
export function pickQuotes(snapshot: MarketSnapshot | null, symbols: readonly string[]): MarketSnapshot | null {
  if (!snapshot) return null;
  const bySymbol = new Map(snapshot.quotes.map((quote) => [quote.symbol, quote]));
  return { ...snapshot, quotes: validMarketSymbols(symbols).flatMap((symbol) => bySymbol.get(symbol) ?? []) };
}

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
  const quotes = MARKET_CATALOG.flatMap(({ symbol, label, icon }) => {
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
// آخرین معامله این‌قدر قدیمی‌تر از خواندن منبع: بازار ساکت است، نه اینکه سامانه به‌روز نشده
const QUIET_MARKET_MS = 3 * 3600_000;

export function formatSnapshot(snapshot: MarketSnapshot | null, live: boolean): string {
  if (!snapshot?.quotes.length) return '💰 قیمت‌ها فعلاً در دسترس نیست. چند دقیقه‌ی دیگر دوباره امتحان کنید.';
  const latest = Math.max(...snapshot.quotes.map((quote) => Date.parse(quote.updatedAt)));
  const lines = snapshot.quotes.map((quote) => {
    const change = quote.changePct === null || quote.changePct === 0 ? '' : ` ${quote.changePct > 0 ? '🔺' : '🔻'}${faNumber(Math.abs(quote.changePct), 2)}٪`;
    // نمادی که از بقیه یک روز عقب‌تر است (مثلاً دینار) تاریخ خودش را نشان می‌دهد
    const old = latest - Date.parse(quote.updatedAt) > 24 * 3600_000 && quote.updatedAtJalali ? ` (${toFaDigits(quote.updatedAtJalali.split(' ')[0])})` : '';
    return `${quote.icon} ${quote.label}: ${faNumber(quote.price, quote.price < 1000 ? 1 : 0)}${change}${old}`;
  });
  const time = new Date(latest).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' });
  // منبع تازه خوانده شده ولی بازار معامله‌ی تازه‌ای ندارد (عصر پنجشنبه تا شنبه، تعطیلی‌ها)
  const quiet = Date.parse(snapshot.fetchedAt) - latest > QUIET_MARKET_MS;
  return [
    '💰 قیمت‌های بازار (تومان)',
    '',
    ...lines,
    '',
    `🕒 آخرین قیمت: ${time}`,
    ...(quiet ? ['ℹ️ از آن زمان معامله‌ی تازه‌ای در بازار ثبت نشده (مثلاً بازار تعطیل است)؛ منبع مرتب بررسی می‌شود.'] : []),
    live
      ? `🔄 این پیام تا ۴۸ ساعت هر ${faNumber(snapshot.refreshMinutes)} دقیقه خودکار به‌روز می‌شود.`
      : `🔄 قیمت‌ها هر ${faNumber(snapshot.refreshMinutes)} دقیقه به‌روز می‌شوند.`,
  ].join('\n');
}

const toFaDigits = (text: string) => text.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
