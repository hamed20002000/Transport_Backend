import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { BotAction, BotContext, BotDialog, BotDialogRegistry, BotReply } from '../messengerBot/core/botDialog';
import { borderOrder, BorderStatusService } from './borderStatus.service';
import { borderDetailText, bordersText, faNumber, tirparkMapUrl } from './borderText';

const PREFIX = 'br:';
const Action = {
  List: `${PREFIX}l`,
  Detail: `${PREFIX}d:`, // + border id
  Close: `${PREFIX}close`,
} as const;

// دکمه‌ی هر مرز دوتا دوتا در یک ردیف
const PER_ROW = 2;

/** ردیف‌بندی دکمه‌ها: هر add یک ردیف و grid چند ردیف دوتایی. */
class Rows {
  private row = 0;
  readonly actions: BotAction[] = [];

  add(...actions: BotAction[]): this {
    if (!actions.length) return this;
    this.actions.push(...actions.map((action) => ({ ...action, row: this.row })));
    this.row++;
    return this;
  }

  grid(actions: BotAction[], perRow = PER_ROW): this {
    for (let i = 0; i < actions.length; i += perRow) this.add(...actions.slice(i, i + perRow));
    return this;
  }
}

/**
 * «🛃 وضعیت مرزها» در ربات‌ها و واتساپ: فهرست مرزها با تعداد صف، و برای هر مرز
 * صف‌ها، اطلاعیه‌ها، آمار و تیرپارک‌ها (با دکمه‌ی مسیریابی). داده از BorderStatusService.
 */
@Injectable()
export class BorderDialog implements BotDialog, OnModuleInit {
  private readonly logger = new Logger(BorderDialog.name);

  readonly entries: Record<string, string> = {
    [BotCallback.Borders]: Action.List,
  };

  constructor(
    private readonly borders: BorderStatusService,
    private readonly registry: BotDialogRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  ownsAction(id: string): boolean {
    return id.startsWith(PREFIX);
  }

  // گفتگوی مرزها فقط دکمه دارد و منتظر متن نیست
  async hasSession(): Promise<boolean> {
    return false;
  }

  async handleText(): Promise<BotReply | null> {
    return null;
  }

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    try {
      if (id === Action.Close) return { text: '', actions: [], closed: 'exit' };
      if (id.startsWith(Action.Detail)) return await this.detail(ctx, id.slice(Action.Detail.length));
      return await this.list(ctx);
    } catch (error) {
      this.logger.error(`Border action ${id} failed for ${ctx.userId}: ${(error as Error).message}`);
      return { text: 'وضعیت مرزها الان در دسترس نیست؛ کمی بعد دوباره امتحان کنید.', actions: [this.back()] };
    }
  }

  private async list(ctx: BotContext): Promise<BotReply> {
    await ctx.progress?.('⏳ در حال دریافت وضعیت مرزها…');
    const details = await this.borders.details();
    // دکمه‌ی هر مرز با تعداد صفش
    const buttons = [...details]
      .sort(borderOrder)
      .map((detail) => ({ id: `${Action.Detail}${detail.border.id}`, label: `${detail.border.name} · ${faNumber(detail.totals.inQueue)}` }));
    return {
      text: `${bordersText(details)}\n\nبرای جزئیات صف‌ها، اطلاعیه‌ها و تیرپارک‌های هر مرز، دکمه‌اش را بزنید.`,
      actions: new Rows().grid(buttons).add({ id: Action.List, label: '🔄 به‌روزرسانی' }, this.back()).actions,
    };
  }

  private async detail(ctx: BotContext, borderId: string): Promise<BotReply> {
    await ctx.progress?.('⏳ در حال دریافت وضعیت مرز…');
    const detail = await this.borders.detail(borderId);
    if (!detail) return this.list(ctx);
    const maps = detail.tirparks.map((tirpark) => ({ id: `map:${tirpark.name}`, label: `🧭 مسیریابی تا ${tirpark.name}`, url: tirparkMapUrl(tirpark.lat, tirpark.lng) }));
    return {
      text: borderDetailText(detail),
      actions: new Rows()
        .grid(maps, 1)
        .add({ id: `${Action.Detail}${borderId}`, label: '🔄 به‌روزرسانی' }, { id: Action.List, label: '🛃 همه‌ی مرزها' })
        .add(this.back()).actions,
    };
  }

  private back(): BotAction {
    return { id: Action.Close, label: '🔙 برگشت' };
  }
}
