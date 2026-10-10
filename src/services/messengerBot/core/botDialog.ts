import { Injectable } from '@nestjs/common';

import { MessengerPlatform } from 'src/domain/enums/messenger';

/** یک گزینه؛ ربات‌ها آن را دکمه (callback_data = id) و واتساپ آیتم شماره‌دار نشان می‌دهند. */
export interface BotAction {
  id: string;
  label: string;
  /**
   * گزینه‌های پشت‌سرهم با row یکسان در ربات‌ها کنار هم در یک ردیف می‌آیند؛ بدون
   * row هر گزینه یک ردیف کامل است. واتساپ دکمه ندارد و این را نادیده می‌گیرد.
   */
  row?: number;
  /**
   * دکمه‌ی لینک (مثل «باز کردن مسیر در نقشه»): به‌جای اجرای id این آدرس باز
   * می‌شود. روبیکا و واتساپ آن را خط «عنوان: لینک» زیر متن نشان می‌دهند.
   */
  url?: string;
}

/** ردیف‌های کیبورد: گزینه‌های پشت‌سرهم با row یکسان یک ردیف می‌شوند. */
export function actionRows(actions: BotAction[]): BotAction[][] {
  const rows: BotAction[][] = [];
  for (const action of actions) {
    const last = rows[rows.length - 1];
    if (last && action.row !== undefined && last[0].row === action.row) last.push(action);
    else rows.push([action]);
  }
  return rows;
}

/**
 * پاسخ مستقل از پلتفرم. `closed`: کاربر از این بخش بیرون رفت ('exit' = خودش
 * بازگشت را زد، 'denied' = دسترسی ندارد و متن باید نمایش داده شود).
 */
export interface BotReply {
  text: string;
  actions: BotAction[];
  closed?: 'exit' | 'denied';
  /**
   * به‌جای دکمه‌های شیشه‌ای، کیبورد پایین با دکمه‌ی «ارسال موقعیت» (با این
   * متن) نشان داده شود؛ فقط این نوع دکمه می‌تواند لوکیشن کاربر را بخواهد.
   */
  locationButton?: string;
  /** عکسی که قبل از متن فرستاده می‌شود (مثل نقشه‌ی مسیر و جایگاه‌های سوخت). */
  photo?: { image: Buffer; caption?: string };
  /** پیام صوتی (ogg/opus) بعد از عکس و قبل از متن؛ مثل خواندن جایگاه‌های سوخت برای راننده‌ای که پشت فرمان است. */
  voice?: { audio: Buffer; caption?: string };
}

/** لوکیشنی که کاربر فرستاده؛ edited = به‌روزرسانی Live Location تلگرام. */
export interface BotLocation {
  latitude: number;
  longitude: number;
  // ثانیه؛ فقط برای Live Location
  livePeriod?: number;
  edited: boolean;
}

/**
 *  برای مشخص کردن اینکه درخواست از کدام پیام رسان و توسط چه کسی ارسال شده است
 */
export interface BotContext {
  platform: MessengerPlatform;
  // شناسه‌ی کاربر در همان پیام‌رسان (externalUserId یا jid واتساپ)
  externalUserId: string;
  // User.id همین سرویس، از هویت تأییدشده‌ی پیام‌رسان
  userId: string;
  /**
   * کار طولانی (مثل محاسبه‌ی مسیر): پیام موقت «⏳ …» تا جواب آماده شود؛
   * پیام‌رسان بعد از جواب پاکش می‌کند (اگر بتواند).
   */
  progress?: (text: string) => Promise<void>;
}

/**
 * گفتگوی چندمرحله‌ای با دکمه برای یک بخش ربات (مثل «گروه‌ها و کانال‌های من» یا
 * «بارهای شرکت»). خروجی فقط متن و گزینه است و هر پیام‌رسان خودش نمایشش می‌دهد.
 */
export interface BotDialog {
  /** دکمه‌های منوی اصلی که این گفتگو را باز می‌کنند: callback منو → اولین action گفتگو. */
  readonly entries: Record<string, string>;
  ownsAction(id: string): boolean;
  /** null یعنی این action مال این گفتگو نیست. */
  handleAction(ctx: BotContext, id: string): Promise<BotReply | null>;
  /** گفتگو منتظر متن کاربر است (مثلاً مرحله‌ی فرم). */
  hasSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<boolean>;
  /** null یعنی متن به این گفتگو مربوط نبود. */
  handleText(ctx: BotContext, text: string): Promise<BotReply | null>;
  /** لوکیشن کاربر؛ null یعنی این گفتگو کاری با آن ندارد. */
  handleLocation?(ctx: BotContext, location: BotLocation): Promise<BotReply | null>;
}

/**
 * گفتگوهایی که ماژول‌شان به MessengerBotModule وابسته است (مثل بارها که برای
 * راننده‌ها پیام می‌فرستد) نمی‌توانند مستقیم import شوند؛ موقع راه‌اندازی
 * خودشان را اینجا ثبت می‌کنند (مثل BotAgentBridge).
 */
@Injectable()
export class BotDialogRegistry {
  private readonly dialogs: BotDialog[] = [];

  /**
   * ثبت botdialog جدید 
   * در خقیقت ایتم جدید در منوی رو اضافه میکند
   * @param dialog 
   */

  //#region -------------------- افزودن botdialog جدید -------------------------------
  register(dialog: BotDialog): void {
    this.dialogs.push(dialog);
  }
  //#endregion ------------------------------------------------------------------------

  /** گفتگو و action ای که این callback (دکمه‌ی منو یا action خود گفتگو) اجرا می‌کند. */
  resolve(callback: string): { dialog: BotDialog; action: string } | null {
    for (const dialog of this.dialogs) {
      if (dialog.ownsAction(callback)) return { dialog, action: callback };
      const entry = dialog.entries[callback];
      if (entry) return { dialog, action: entry };
    }
    return null;
  }

  /**
   * لیست همه دیالوگ ها Botdialog ها رو برمیگردونه
   * @returns 
   */

  //#region ------------------------------- لیست همه دیالوگ ها ----------------------
  all(): readonly BotDialog[] {
    return this.dialogs;
  }
  //#endregion -----------------------------------------------------------------------
}
