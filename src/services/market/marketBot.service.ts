import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

import { BotAction, BotContext, BotDialog, BotDialogRegistry, BotReply } from '../messengerBot/core/botDialog';
import { MultiBot } from '../messengerBot/core/multiBot';
import { RedisService } from '../redis/redis.service';
import { formatSnapshot, MARKET_CATALOG, MARKET_REFRESH_MINUTES, MarketPriceService, MarketSnapshot, MAX_MARKET_SYMBOLS, pickQuotes } from './marketPrice.service';
import { MarketPreferenceService } from './marketPreference.service';
import { BotCallback } from '../../domain/constants/bot/BotCallback';

export const MarketAction = {
  // دکمه‌ی منوی راننده و شرکت (و بخش واتساپ)
  Show: 'mk:show',
  Close: 'mk:close',
  // دکمه‌ی زیر همان پیام قیمت
  Refresh: 'mk:refresh',
  // انتخاب ارزها و طلای نوار قیمت
  Choose: 'mk:cfg',
  Toggle: 'mk:t:', // + symbol
} as const;

const faNumber = (value: number) => value.toLocaleString('fa-IR');

// پیام قیمت تا این مدت بعد از آخرین «قیمت‌ها»/«به‌روزرسانی» خودکار ویرایش می‌شود
const LIVE_HOURS = 48;
// فاصله‌ی ویرایش‌ها تا به سقف ارسال پیام‌رسان‌ها (حدود ۳۰ در ثانیه) نخوریم
const EDIT_GAP_MS = 60;

interface LiveMessage {
  messageId: number;
  until: number;
  // قلم‌های صاحب چت؛ پیام‌های قدیمی‌تر ندارند و پیش‌فرض می‌گیرند
  symbols?: string[];
}

/**
 * قیمت‌ها در ربات‌ها: «قیمت‌ها» یک پیام تازه می‌فرستد و همان پیام (یکی برای هر چت)
 * تا ۴۸ ساعت هر ۳۰ دقیقه با قیمت جدید ویرایش می‌شود. واتساپ ویرایش ندارد و همان
 * لحظه متن را می‌گیرد (BotDialog).
 */
@Injectable()
export class MarketBotService implements BotDialog, OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MarketBotService.name);
  readonly entries: Record<string, string> = {};
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prices: MarketPriceService,
    private readonly multiBot: MultiBot,
    private readonly redis: RedisService,
    private readonly registry: BotDialogRegistry,
    private readonly config: ConfigService,
    private readonly preferences: MarketPreferenceService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  onApplicationBootstrap(): void {
    if (this.config.get('MARKET_PRICES_WORKER', 'true') === 'false') return;
    void this.tick();
    // دو دقیقه بعد از هر نیم ساعت، وقتی منبع قیمت‌های تازه را منتشر کرده
    const now = new Date();
    const delay = ((32 - (now.getMinutes() % 30)) % 30 || 30) * 60_000 - now.getSeconds() * 1000;
    this.timer = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), MARKET_REFRESH_MINUTES * 60_000);
    }, delay);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  // ---------------- BotDialog (واتساپ، و انتخاب ارزها در همه‌ی پیام‌رسان‌ها) ----------------

  ownsAction(id: string): boolean {
    return id.startsWith('mk:');
  }

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    if (id === MarketAction.Close) return { text: '', actions: [], closed: 'exit' };
    if (id === MarketAction.Choose) return this.chooser(ctx);
    if (id.startsWith(MarketAction.Toggle)) {
      const symbol = id.slice(MarketAction.Toggle.length);
      const saved = await this.preferences.toggle(ctx.userId, symbol);
      const label = (value: string) => MARKET_CATALOG.find((item) => item.symbol === value)?.label ?? value;
      const notice = !saved
        ? 'دست‌کم یک قلم باید بماند.'
        : saved.replaced
          ? `«${label(symbol)}» جای «${label(saved.replaced)}» را گرفت (حداکثر ${faNumber(MAX_MARKET_SYMBOLS)} قلم).`
          : null;
      return this.chooser(ctx, notice);
    }
    return {
      text: formatSnapshot(pickQuotes(await this.prices.current(), await this.preferences.symbolsOf(ctx.userId)), false),
      actions: [{ id: MarketAction.Choose, label: '⚙️ انتخاب ارزها' }, { id: MarketAction.Close, label: '↩️ بازگشت' }],
    };
  }

  /** همه‌ی قلم‌ها با ✅ روی انتخاب‌ها؛ زدن هر کدام اضافه یا برداشته می‌شود. */
  private async chooser(ctx: BotContext, notice?: string | null): Promise<BotReply> {
    const selected = await this.preferences.symbolsOf(ctx.userId);
    const actions: BotAction[] = MARKET_CATALOG.map((item, index) => ({
      id: `${MarketAction.Toggle}${item.symbol}`,
      label: `${selected.includes(item.symbol) ? '✅' : item.icon} ${item.label}`,
      row: Math.floor(index / 2),
    }));
    actions.push({ id: MarketAction.Show, label: '💰 دیدن قیمت‌ها', row: Math.ceil(MARKET_CATALOG.length / 2) });
    actions.push({ id: MarketAction.Close, label: '↩️ بازگشت', row: Math.ceil(MARKET_CATALOG.length / 2) + 1 });
    const chosen = selected.map((symbol) => MARKET_CATALOG.find((item) => item.symbol === symbol)?.label).filter(Boolean);
    return {
      text: [
        notice,
        `⚙️ انتخاب ارزها و طلا (حداکثر ${faNumber(MAX_MARKET_SYMBOLS)} قلم)`,
        `انتخاب فعلی: ${chosen.join('، ')}`,
        'برای افزودن یا برداشتن، دکمه‌ی هر قلم را بزنید؛ همین قلم‌ها در پیام قیمت و پنل وب نشان داده می‌شوند.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      actions,
    };
  }

  async hasSession(): Promise<boolean> {
    return false;
  }

  async handleText(): Promise<BotReply | null> {
    return null;
  }

  // ---------------- تلگرام، بله، روبیکا ----------------

  /** پیام تازه‌ی قیمت با قلم‌های کاربر؛ پیام زنده‌ی قبلی همین چت دیگر ویرایش نمی‌شود. */
  async send(chatId: string, userId?: string | null): Promise<number> {
    const symbols = await this.preferences.symbolsOf(userId);
    const message = await this.multiBot.sendMessage(chatId, formatSnapshot(pickQuotes(await this.prices.current(), symbols), true), {
      reply_markup: this.markup(),
    });
    await this.keepLive(chatId, message.message_id, symbols);
    return message.message_id;
  }

  /** دکمه‌ی «به‌روزرسانی» زیر پیام قیمت: همان پیام ویرایش و ۴۸ ساعت دیگر زنده می‌ماند. */
  async refresh(chatId: string, messageId: number, userId?: string | null): Promise<void> {
    const symbols = await this.preferences.symbolsOf(userId);
    await this.edit(chatId, messageId, formatSnapshot(pickQuotes(await this.prices.current(), symbols), true));
    await this.keepLive(chatId, messageId, symbols);
  }

  /** یک دور: قیمت تازه از منبع، بعد ویرایش همه‌ی پیام‌های زنده. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // فقط نمونه‌ای که قفل را گرفت و قیمت تازه خواند پیام‌ها را ویرایش می‌کند
      const snapshot = await this.prices.refresh();
      if (snapshot && this.multiBot.configured) await this.editLiveMessages(snapshot);
    } catch (error: unknown) {
      this.logger.error(`Market prices tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** هر پیام زنده با قلم‌های صاحبش؛ متن هر ترکیب یک بار ساخته می‌شود. */
  private async editLiveMessages(snapshot: MarketSnapshot): Promise<void> {
    const texts = new Map<string, string>();
    const textFor = (symbols: string[] | undefined) => {
      const key = (symbols ?? []).join(',');
      if (!texts.has(key)) texts.set(key, formatSnapshot(pickQuotes(snapshot, symbols ?? []), true));
      return texts.get(key)!;
    };
    const key = RedisService.key('marketLiveMessages');
    const all = await this.redis.hashGetAll(key);
    const expired: string[] = [];
    let edited = 0;
    for (const [chatId, value] of Object.entries(all)) {
      const live = JSON.parse(value) as LiveMessage;
      if (live.until < Date.now()) {
        expired.push(chatId);
        continue;
      }
      if (!(await this.edit(chatId, live.messageId, textFor(live.symbols)))) expired.push(chatId);
      else edited++;
      await new Promise((resolve) => setTimeout(resolve, EDIT_GAP_MS));
    }
    await this.redis.hashDelete(key, ...expired);
    if (edited || expired.length) this.logger.log(`Market prices: updated ${edited} live message(s), dropped ${expired.length}.`);
  }

  /** false یعنی پیام دیگر قابل ویرایش نیست (پاک شده، ربات بلاک شده، پیام‌رسان غیرفعال). */
  private async edit(chatId: string, messageId: number, text: string): Promise<boolean> {
    try {
      await this.multiBot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: this.markup() });
      return true;
    } catch (error: unknown) {
      // «not modified» (قیمت عوض نشده) یا خطای گذرا: زنده می‌ماند و ۴۸ ساعته خودش منقضی می‌شود
      return !/not found|forbidden|blocked|deactivated|can't be edited|invalid|not configured/i.test((error as Error)?.message ?? '');
    }
  }

  private async keepLive(chatId: string, messageId: number, symbols: string[]): Promise<void> {
    const live: LiveMessage = { messageId, until: Date.now() + LIVE_HOURS * 3600_000, symbols };
    await this.redis.hashSet(RedisService.key('marketLiveMessages'), chatId, JSON.stringify(live));
  }

  private markup(): TelegramBot.InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '🔄 به‌روزرسانی', callback_data: MarketAction.Refresh },
          { text: '⚙️ انتخاب ارزها', callback_data: MarketAction.Choose },
        ],
        [{ text: '↩️ بازگشت', callback_data: BotCallback.MainMenu }],
      ],
    };
  }
}
