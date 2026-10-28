# راه‌اندازی ربات روبیکا

ربات روبیکا یک **ربات رسمی** (`botapi.rubika.ir`) است و نصب یا دانلود جداگانه ندارد. فقط توکن لازم است.
کد مربوط: `src/services/messengerBot/rubika/`. منطق ربات با تلگرام مشترک است.

> **هشدار:** توکن ربات و رمز webhook را هیچ‌جا نفرستید.
> برای سیستم محلی و سرور **دو ربات جدا** بسازید (بخش «محلی و production»).

---

## ۱. ساخت ربات

1. در روبیکا به `@BotFather` پیام بدهید و ربات تازه بسازید.
2. اسم نمایشی (مثلاً «ترابوت») و یک آیدی بدهید (مثلاً `tarabot_bot`).
3. توکن ربات را بگیرید.

## ۲. متغیرهای `.env` بک‌اند

### حالت polling (پیش‌فرض؛ برای محلی)

```env
RUBIKA_BOT_TOKEN=<توکن BotFather روبیکا>
RUBIKA_BOT_USERNAME=tarabot_bot
```

دکمه‌ها در کیبورد پایین چت نشان داده می‌شوند.

### حالت webhook (برای production)

```env
RUBIKA_BOT_TOKEN=<توکن BotFather روبیکا>
RUBIKA_BOT_USERNAME=tarabot_bot
RUBIKA_WEBHOOK_URL=https://your-domain.com/rubika/webhook
RUBIKA_WEBHOOK_SECRET=<خروجی openssl rand -hex 32>
```

ساخت رمز:

```bash
openssl rand -hex 32
```

دکمه‌ها زیر خود پیام می‌آیند، مثل تلگرام.

| متغیر | توضیح |
| --- | --- |
| `RUBIKA_BOT_TOKEN` | توکن ربات؛ خالی یعنی ربات روبیکا خاموش |
| `RUBIKA_BOT_USERNAME` | آیدی ربات بدون `@`؛ برای لینک دعوت (`https://rubika.ir/<آیدی>`). روبیکا لینک شروع با کد ندارد، پس کاربر کد دعوت را خودش برای ربات می‌فرستد. |
| `RUBIKA_WEBHOOK_URL` | اختیاری؛ آدرس **پایه‌ی** عمومی مسیر `/rubika/webhook`، **بدون** رمز |
| `RUBIKA_WEBHOOK_SECRET` | با `RUBIKA_WEBHOOK_URL` اجباری است |

روبیکا webhook را امضا نمی‌کند، پس رمز داخل خود آدرس قرار می‌گیرد.
بک‌اند هنگام شروع آدرس `RUBIKA_WEBHOOK_URL/<RUBIKA_WEBHOOK_SECRET>` را خودش روی روبیکا ثبت می‌کند.
از رمز hex استفاده کنید تا در آدرس مشکلی پیش نیاید.

reverse proxy (مثلاً nginx) باید `POST /rubika/webhook/...` را بدون احراز هویت اضافه به بک‌اند برساند.
لاگ دسترسی nginx آدرس کامل را ثبت می‌کند و رمز در آن هست؛ این لاگ را محرمانه نگه دارید.

## ۳. ری‌استارت بک‌اند

| پیام لاگ | معنی |
| --- | --- |
| `RUBIKA_BOT_TOKEN is not configured. Rubika bot is disabled.` | توکن خالی است |
| `RUBIKA_WEBHOOK_SECRET is required with RUBIKA_WEBHOOK_URL.` | آدرس webhook هست ولی رمز نیست |
| `Rubika bot started in polling mode.` / `... webhook mode.` | ربات روشن شد |
| `Failed to start Rubika bot: ...` | توکن اشتباه است، سرور به `botapi.rubika.ir` نمی‌رسد، یا روبیکا آدرس webhook را نپذیرفت |

در حالت polling، جای آخرین آپدیت خوانده‌شده در Redis نگه داشته می‌شود و بعد از ری‌استارت پیام تکراری نمی‌آید.

## ۴. تست

1. در روبیکا ربات را باز کنید و پیام بدهید.
2. دکمه‌ی «ارسال شماره» را بزنید.
3. اگر این شماره در ترابوت ثبت‌نام کرده باشد، حساب وصل می‌شود و منو می‌آید.

## محلی و production

- **دو ربات جدا بسازید**. اگر توکن سرور را محلی اجرا کنید، یا آپدیت‌ها بین دو برنامه تقسیم می‌شود (polling)، یا آدرس webhook سرور عوض می‌شود.
- فقط **یک نسخه** از بک‌اند را با هر توکن اجرا کنید.
