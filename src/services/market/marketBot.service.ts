import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

import { BotContext, BotDialog, BotDialogRegistry, BotReply } from '../messengerBot/core/botDialog';
import { MultiBot } from '../messengerBot/core/multiBot';
import { RedisService } from '../redis/redis.service';
import { formatSnapshot, MARKET_REFRESH_MINUTES, MarketPriceService } from './marketPrice.service';

export const MarketAction = {
  // دکمه‌ی منوی راننده و شرکت (و بخش واتساپ)
  Show: 'mk:show',
  // دکمه‌ی زیر همان پیام قیمت
  Refresh: 'mk:refresh',
} as const;

// پیام قیمت تا این مدت بعد از آخرین «قیمت‌ها»/«به‌روزرسانی» خودکار ویرایش می‌شود
const LIVE_HOURS = 48;
// فاصله‌ی ویرایش‌ها تا به سقف ارسال پیام‌رسان‌ها (حدود ۳۰ در ثانیه) نخوریم
const EDIT_GAP_MS = 60;

interface LiveMessage {
  messageId: number;
  until: number;
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

  // ---------------- BotDialog (واتساپ) ----------------

  ownsAction(id: string): boolean {
    return id === MarketAction.Show || id === MarketAction.Refresh;
  }

  async handleAction(_ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    return { text: formatSnapshot(await this.prices.current(), false), actions: [] };
  }

  async hasSession(): Promise<boolean> {
    return false;
  }

  async handleText(): Promise<BotReply | null> {
    return null;
  }

  // ---------------- تلگرام، بله، روبیکا ----------------

  /** پیام تازه‌ی قیمت؛ پیام زنده‌ی قبلی همین چت دیگر ویرایش نمی‌شود. */
  async send(chatId: string): Promise<void> {
    const message = await this.multiBot.sendMessage(chatId, formatSnapshot(await this.prices.current(), true), { reply_markup: this.markup() });
    await this.keepLive(chatId, message.message_id);
  }

  /** دکمه‌ی «به‌روزرسانی» زیر پیام قیمت: همان پیام ویرایش و ۴۸ ساعت دیگر زنده می‌ماند. */
  async refresh(chatId: string, messageId: number): Promise<void> {
    await this.edit(chatId, messageId, formatSnapshot(await this.prices.current(), true));
    await this.keepLive(chatId, messageId);
  }

  /** یک دور: قیمت تازه از منبع، بعد ویرایش همه‌ی پیام‌های زنده. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // فقط نمونه‌ای که قفل را گرفت و قیمت تازه خواند پیام‌ها را ویرایش می‌کند
      const snapshot = await this.prices.refresh();
      if (snapshot && this.multiBot.configured) await this.editLiveMessages(formatSnapshot(snapshot, true));
    } catch (error: unknown) {
      this.logger.error(`Market prices tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async editLiveMessages(text: string): Promise<void> {
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
      if (!(await this.edit(chatId, live.messageId, text))) expired.push(chatId);
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

  private async keepLive(chatId: string, messageId: number): Promise<void> {
    const live: LiveMessage = { messageId, until: Date.now() + LIVE_HOURS * 3600_000 };
    await this.redis.hashSet(RedisService.key('marketLiveMessages'), chatId, JSON.stringify(live));
  }

  private markup(): TelegramBot.InlineKeyboardMarkup {
    // دکمه‌ی دیگری (مثل منوی اصلی) ندارد: منوی بعدی نباید جای این پیام را بگیرد
    return { inline_keyboard: [[{ text: '🔄 به‌روزرسانی', callback_data: MarketAction.Refresh }]] };
  }
}
