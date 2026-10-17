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
  return { text: plain, entities };
}

/** واتساپ: هر خط کارت با «> » نقل‌قول می‌شود (کادر با نوار کناری). */
export function whatsappCards(text: string): string {
  return text.replace(CARD, (_, body: string) => body.split('\n').map((line) => `> ${line}`).join('\n'));
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
