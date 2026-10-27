import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { User } from 'src/domain/entities/auth/User';
import { BotContext, BotDialog, BotDialogRegistry, BotReply } from '../messengerBot/core/botDialog';

const PREFIX = 'dsp:';
const Action = { Show: `${PREFIX}s`, Text: `${PREFIX}t`, Image: `${PREFIX}i`, Close: `${PREFIX}b` } as const;

const TEXTS = {
  TEXT: '📝 بارها الان «متنی» نمایش داده می‌شوند: فقط مشخصات بار.',
  IMAGE: '🖼 بارها الان «تصویری» نمایش داده می‌شوند: عکس بار (یا تصویری از نوع بار) و بعد مشخصاتش.',
};

/**
 * «🖼 نحوه‌ی نمایش بار» در ربات‌ها و واتساپ: متنی یا تصویری (User.cargoDisplay)، همان انتخابی که در پنل وب هست.
 * در تصویری، اعلان هر بار با عکسش می‌آید (CargoNotificationService).
 */
@Injectable()
export class CargoDisplayDialog implements BotDialog, OnModuleInit {
  readonly entries: Record<string, string> = { [BotCallback.CargoDisplay]: Action.Show };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: BotDialogRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  ownsAction(id: string): boolean {
    return id.startsWith(PREFIX);
  }

  // one tap a choice: nothing waits for text
  async hasSession(): Promise<boolean> {
    return false;
  }

  async handleText(): Promise<BotReply | null> {
    return null;
  }

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    if (id === Action.Close) return { text: '', actions: [], closed: 'exit' };
    const users = this.dataSource.getRepository(User);
    if (id === Action.Text || id === Action.Image) {
      await users.update({ id: ctx.userId }, { cargoDisplay: id === Action.Image ? 'IMAGE' : 'TEXT' });
    }
    const user = await users.findOne({ where: { id: ctx.userId }, select: { id: true, cargoDisplay: true } });
    const current = user?.cargoDisplay === 'IMAGE' ? 'IMAGE' : 'TEXT';
    return {
      text: `${TEXTS[current]}\n\nبرای تغییر یکی را انتخاب کنید (در پنل وب هم همین انتخاب اعمال می‌شود):`,
      actions: [
        { id: Action.Text, label: `${current === 'TEXT' ? '✅ ' : ''}📝 متنی`, row: 0 },
        { id: Action.Image, label: `${current === 'IMAGE' ? '✅ ' : ''}🖼 تصویری`, row: 0 },
        { id: Action.Close, label: '🏠 منوی اصلی', row: 1 },
      ],
    };
  }
}
