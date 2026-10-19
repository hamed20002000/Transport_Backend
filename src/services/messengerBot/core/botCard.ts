import type TelegramBot from 'node-telegram-bot-api';

// نشانه‌های نامرئی (Private Use) دور هر کارت؛ در متن عادی پیام‌ها نمی‌آیند و پیش از ارسال حذف می‌شوند.
const OPEN = '';
const CLOSE = '';
const CARD = new RegExp(`${OPEN}([\\s\\S]*?)${CLOSE}`, 'g');
const MARKERS = new RegExp(`[${OPEN}${CLOSE}]`, 'g');

/**
 * بخشی از پیام که در کادر جدا (کارت) نشان داده شود، مثل هر مسیر یا خلاصه‌ی بار.
 * هر پیام‌رسان آن را به شکل خودش نشان می‌دهد (cardsFor)؛ متن کارت تک‌خطی یا چندخطی است.
 */
export function card(text: string): string {
  const body = text.replace(MARKERS, '').trim();
  return body ? `${OPEN}${body}${CLOSE}` : '';
}

/** متن کارت دارد؟ (مثلاً سؤال نظرسنجی واتساپ قالب‌بندی نمی‌پذیرد) */
export function hasCards(text: string): boolean {
  return text.includes(OPEN);
}

/** تلگرام: کادر نقل‌قول (blockquote) با entities، تا متن نیازی به escape شدن HTML نداشته باشد. */
export function telegramCards(text: string): { text: string; entities: TelegramBot.MessageEntity[] } {
  const entities: TelegramBot.MessageEntity[] = [];
  let plain = '';
  let last = 0;
  for (const match of text.matchAll(CARD)) {
    plain += text.slice(last, match.index).replace(MARKERS, '');
    // offset/length در تلگرام بر حسب UTF-16 است؛ همان index رشته‌ی JS
    entities.push({ type: 'blockquote' as TelegramBot.MessageEntityType, offset: plain.length, length: match[1].length });
    plain += match[1];
    last = match.index + match[0].length;
  }
  plain += text.slice(last).replace(MARKERS, '');
  for (const match of plain.matchAll(/(?<!\d)\+98\d{10}(?!\d)/g)) {
    entities.push({ type: 'phone_number', offset: match.index, length: match[0].length });
  }
  return { text: plain, entities };
}

/** واتساپ: هر خط کارت با «> » نقل‌قول می‌شود (کادر با نوار کناری). */
export function whatsappCards(text: string): string {
  return text.replace(CARD, (_, body: string) => body.split('\n').map((line) => `> ${line}`).join('\n'));
}

const faDigits = (value: number) => String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

/**
 * گزینه‌های شماره‌دار واتساپ (که دکمه ندارد): «۱- نمایش منو». هر کاری که کاربر می‌تواند
 * بکند یک گزینه است؛ به‌جای «برای … بنویسید» فقط شماره‌ی گزینه فرستاده می‌شود.
 */
export function whatsappOptions(labels: string[], start = 1): string {
  return labels.map((label, index) => `${faDigits(start + index)}- ${label}`).join('\n');
}

// دو گزینه‌ی یک ردیف تا این طول (هر دو با هم) در یک خط می‌آیند؛ بلندتر روی گوشی به هم می‌ریزد
const ROW_LINE_LIMIT = 38;

/**
 * مثل whatsappOptions، ولی گزینه‌هایی که در ربات‌ها یک ردیف‌اند (BotAction.row / Rows.grid) در
 * یک خط کنار هم: «۱- 📣 اعلام ۱    ۲- 📣 اعلام ۲». شماره‌ها پشت‌سرهم می‌مانند.
 */
export function whatsappOptionRows(rows: string[][], start = 1): string {
  const lines: string[] = [];
  let number = start;
  for (const row of rows) {
    const items = row.map((label) => `${faDigits(number++)}- ${label}`);
    if (items.length > 1 && items.join('').length <= ROW_LINE_LIMIT) lines.push(items.join('    '));
    else lines.push(...items);
  }
  return lines.join('\n');
}

/** بله و روبیکا کادر نقل‌قول ربات ندارند: نوار عمودی کنار هر خط کارت. */
export function plainCards(text: string): string {
  return text.replace(CARD, (_, body: string) => body.split('\n').map((line) => `┃ ${line}`).join('\n'));
}

/** متن کارت‌دار برای یک پیام‌رسان؛ entities فقط برای تلگرام. */
export function cardsFor(platform: 'telegram' | 'bale' | 'rubika', text: string): { text: string; entities?: TelegramBot.MessageEntity[] } {
  if (!text.includes(OPEN)) return { text };
  if (platform === 'telegram') {
    const result = telegramCards(text);
    return result.entities.length ? result : { text: result.text };
  }
  return { text: plainCards(text) };
}
