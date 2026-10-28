# راه‌اندازی ربات تلگرام

ربات تلگرام یک **ربات رسمی** (Bot API) است و نصب یا دانلود جداگانه ندارد. فقط توکن لازم است.
کد مربوط: `src/services/messengerBot/telegram/`. جزئیات فنی webhook در `docs/telegram-webhook.md` آمده.

> **هشدار:** توکن ربات را هیچ‌جا نفرستید. اگر لو رفت، از BotFather با `/revoke` توکن تازه بگیرید.
> برای سیستم محلی و سرور **دو ربات جدا** بسازید (بخش «محلی و production»).

---

## ۱. ساخت ربات

1. در تلگرام به `@BotFather` پیام بدهید و `/newbot` را بفرستید.
2. یک اسم نمایشی بدهید (مثلاً «ترابوت»).
3. یک آیدی بدهید که به `bot` ختم شود (مثلاً `tarabot_bot`).
4. BotFather یک توکن به شکل `123456789:AA...` می‌دهد.

اختیاری، از همان BotFather:

- `/setuserpic`: عکس ربات
- `/setdescription`: متنی که کاربر پیش از Start می‌بیند

## ۲. متغیرهای `.env` بک‌اند

### حالت polling (پیش‌فرض؛ برای محلی)

```env
TELEGRAM_BOT_TOKEN=<توکن BotFather>
TELEGRAM_BOT_USERNAME=tarabot_bot
TELEGRAM_BOT_MODE=polling
```

### حالت webhook (برای production)

```env
TELEGRAM_BOT_TOKEN=<توکن BotFather>
TELEGRAM_BOT_USERNAME=tarabot_bot
TELEGRAM_BOT_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=<خروجی openssl rand -hex 32>
```

ساخت رمز:

```bash
openssl rand -hex 32
```

| متغیر | توضیح |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | توکن ربات؛ خالی یعنی ربات تلگرام خاموش |
| `TELEGRAM_BOT_USERNAME` | آیدی ربات بدون `@`؛ برای لینک‌های دعوت (`https://t.me/<آیدی>?start=<کد>`). خالی یعنی لینک تلگرام در دعوت‌ها نمی‌آید. |
| `TELEGRAM_BOT_MODE` | `polling` یا `webhook`؛ خالی یعنی `polling` |
| `TELEGRAM_WEBHOOK_URL` | فقط در webhook: آدرس **HTTPS عمومی** و کامل مسیر `/telegram/webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | فقط در webhook: ۱ تا ۲۵۶ کاراکتر از حروف انگلیسی، عدد، `_` و `-` |

در حالت webhook، reverse proxy (مثلاً nginx) باید `POST /telegram/webhook` را بدون احراز هویت اضافه به بک‌اند برساند و هدر `X-Telegram-Bot-Api-Secret-Token` را نگه دارد.

## ۳. ری‌استارت بک‌اند

| پیام لاگ | معنی |
| --- | --- |
| `TELEGRAM_BOT_TOKEN is not configured. Telegram bot is disabled.` | توکن خالی است |
| `Telegram bot started in polling mode.` / `... webhook mode.` | ربات روشن شد |
| `Failed to start Telegram bot: ... Retrying in ...` | سرور به تلگرام نمی‌رسد (فیلتر یا قطعی VPN)؛ بک‌اند در پس‌زمینه دوباره تلاش می‌کند و بقیه‌ی ربات‌ها معطل نمی‌شوند |
| `TELEGRAM_WEBHOOK_URL must be ...` | آدرس webhook HTTPS نیست یا شکلش اشتباه است |

سرور باید به `api.telegram.org` دسترسی داشته باشد. اتصال فقط از IPv4 است.

## ۴. تست

1. در تلگرام ربات را باز کنید و Start بزنید.
2. ربات دکمه‌ی «ارسال شماره» را نشان می‌دهد. آن را بزنید.
3. اگر این شماره در ترابوت ثبت‌نام کرده باشد، حساب وصل می‌شود و منو می‌آید.

فقط شماره‌ی **خود** کاربر پذیرفته می‌شود. کارت تماس فرد دیگر یا contact فورواردشده رد می‌شود.

## محلی و production

- **دو ربات جدا بسازید**: یکی برای سیستم محلی (polling) و یکی برای سرور (webhook).
  اگر توکن سرور را محلی با polling اجرا کنید، بک‌اند محلی webhook سرور را **پاک می‌کند** و ربات سرور از کار می‌افتد.
- فقط **یک نسخه** از بک‌اند را با هر توکن اجرا کنید.
- برگشت از webhook به polling: `TELEGRAM_BOT_MODE=polling` و ری‌استارت. webhook حذف می‌شود ولی آپدیت‌های در صف از دست نمی‌روند.
