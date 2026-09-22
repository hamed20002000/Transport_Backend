# روال کار بات تلگرام در پروژه

این سند رفتار فعلی کد را توضیح می‌دهد. بات دو روش برای دریافت پیام دارد: `polling` و `webhook`. انتخاب روش فقط مسیر ورود پیام را تغییر می‌دهد؛ منطق منو، خرید، دریافت شماره تماس و رسید در هر دو حالت مشترک است.

## نقش فایل‌ها

| فایل | مسئولیت |
| --- | --- |
| `src/application/module/TelegramModule.ts` | ثبت سرویس‌ها و کنترلر تلگرام در Nest |
| `src/services/telegram/telegram.service.ts` | ساخت بات، ثبت دستورات و هدایت پیام‌ها به منطق برنامه |
| `src/services/telegram/telegramTransport.ts` | خواندن تنظیمات روش دریافت، شروع polling یا ثبت webhook و بررسی secret |
| `src/services/telegram/telegramWebhook.controller.ts` | دریافت درخواست HTTP تلگرام و انتقال آن به `receiveWebhook` |
| `src/services/telegram/telegramAccountHandler.service.ts` | اجرای مراحل حساب و خرید، دریافت تماس و رسید |
| `src/services/telegram/telegramIdentity.service.ts` | ثبت و به‌روزرسانی هویت کاربر تلگرام |
| `src/services/telegram/telegramSession.service.ts` | نگهداری وضعیت مکالمه در حافظه برنامه |
| `src/services/telegram/telegramMenu.service.ts` | نمایش منوها |
| `src/services/telegram/telegramMessages.service.ts` | تهیه متن پیام‌ها |

## ۱. هنگام بالا آمدن برنامه چه اتفاقی می‌افتد؟

Nest متد `TelegramService.onModuleInit()` را اجرا می‌کند:

1. مقدار `TELEGRAM_BOT_TOKEN` خوانده می‌شود. اگر وجود نداشته باشد، بات غیرفعال می‌ماند و یک هشدار ثبت می‌شود.
2. شیء `TelegramTransport` ساخته می‌شود و `TELEGRAM_BOT_MODE` را می‌خواند. مقدار پیش‌فرض `polling` است. فقط `polling` و `webhook` پذیرفته می‌شوند.
3. در حالت webhook، آدرس HTTPS و قالب secret بررسی می‌شوند. این بررسی به معنی تست دسترسی عمومی آدرس نیست.
4. بات با `polling: false` ساخته می‌شود تا پیش از آماده شدن handlerها دریافت پیام شروع نشود. این مقدار به معنی غیرفعال شدن دائمی polling نیست.
5. دستورات `/start` و `/payment` با `setMyCommands` ثبت می‌شوند.
6. listenerهای `message`، `callback_query` و `polling_error` متصل می‌شوند.
7. متد `transport.start(bot)` روش انتخاب‌شده را فعال می‌کند.
8. پس از موفقیت، `ready = true` می‌شود و روش فعال در لاگ ثبت می‌شود.

خطای تنظیمات، ثبت دستورات یا شروع transport در این مرحله پنهان نمی‌شود و می‌تواند راه‌اندازی برنامه را متوقف کند.

## ۲. مسیر دریافت در حالت polling

در این حالت برنامه از تلگرام updateها را دریافت می‌کند و به مسیر HTTP عمومی برای دریافت پیام نیاز ندارد.

```text
TelegramService.onModuleInit()
  → transport.start(bot)
  → bot.deleteWebHook()
  → bot.startPolling()
  → دریافت update توسط کتابخانه
  → رویداد message یا callback_query
  → handleMessage() یا handleCallbackQuery()
```

ابتدا webhook قبلی حذف می‌شود تا مانع polling نباشد. گزینه حذف updateهای معلق ارسال نمی‌شود. بعد از شروع polling، کتابخانه رویدادها را منتشر می‌کند و listenerهای ثبت‌شده منطق فعلی برنامه را اجرا می‌کنند.

خطاهای handlerها در listenerهای polling گرفته و لاگ می‌شوند؛ مسیر HTTP و پاسخ HTTP در این حالت وجود ندارد.

## ۳. مسیر دریافت در حالت webhook

در این حالت تلگرام update را به آدرس عمومی برنامه ارسال می‌کند. هنگام startup، کد این تنظیمات را با `bot.setWebHook()` ثبت می‌کند:

| تنظیم | مقدار و کاربرد |
| --- | --- |
| URL | مقدار کامل `TELEGRAM_WEBHOOK_URL` |
| `secret_token` | مقدار `TELEGRAM_WEBHOOK_SECRET` برای احراز درخواست |
| `max_connections` | مقدار `1` برای محدود کردن اتصال‌های تحویل webhook |
| `allowed_updates` | فقط `message` و `callback_query` |

در این شاخه `startPolling()` اجرا نمی‌شود. مسیر ورود پیام به این صورت است:

```text
کاربر پیام می‌فرستد یا دکمه inline را می‌زند
  → تلگرام یک درخواست POST می‌فرستد
  → HTTPS reverse proxy
  → POST /telegram/webhook
  → TelegramWebhookController.receive()
  → TelegramService.receiveWebhook(update, secret)
  → handleMessage() یا handleCallbackQuery()
  → پایان پردازش و پاسخ HTTP 200
```

کنترلر body درخواست و هدر `X-Telegram-Bot-Api-Secret-Token` را می‌گیرد. خودش منطق خرید یا منو را اجرا نمی‌کند؛ هر دو مقدار را به سرویس می‌دهد.

### داخل receiveWebhook چه اتفاقی می‌افتد؟

ترتیب بررسی‌ها در کد مهم است:

1. اگر transport ساخته نشده باشد، پاسخ `503` داده می‌شود؛ مثلاً وقتی توکن بات تنظیم نشده است.
2. `transport.authorize(secret)` اجرا می‌شود. اگر روش فعلی polling باشد، پاسخ `404` است. در حالت webhook، secret اشتباه یا غایب باعث پاسخ `401` می‌شود.
3. اگر `ready` هنوز false باشد، پاسخ `503` داده می‌شود.
4. `update_id` باید عدد صحیح امن و نامنفی باشد؛ در غیر این صورت پاسخ `400` است. اعتبارسنجی فعلی محدود به همین شناسه است و schema کامل پیام را بررسی نمی‌کند.
5. اگر `update.message` موجود باشد، `handleMessage` اجرا می‌شود. در غیر این صورت، اگر `update.callback_query` موجود باشد، `handleCallbackQuery` اجرا می‌شود.
6. سرویس با `await` منتظر پایان handler می‌ماند. updateهای دیگر با شناسه معتبر پردازش نمی‌شوند و پاسخ موفق می‌گیرند.

در این مسیر از `bot.processUpdate()` استفاده نشده است؛ handlerهای مشترک مستقیماً فراخوانی می‌شوند تا درخواست HTTP بتواند منتظر پایان پردازش بماند. وجود listenerهای polling روی شیء بات باعث دوبار پردازش شدن webhook نمی‌شود.

کنترلر کد موفقیت را `200` تعیین می‌کند. interceptor عمومی پروژه می‌تواند بدنه پاسخ را در قالب عمومی API قرار دهد.

## ۴. منطق مشترک پیام و دکمه

`handleMessage()` ابتدا اطلاعات فرستنده را از طریق سرویس هویت ثبت یا به‌روزرسانی می‌کند. سپس بسته به نوع پیام، مسیر مناسب را انتخاب می‌کند: `/start` برای منوی اصلی، `/payment` برای وضعیت خرید، contact برای شماره تماس، عکس یا سند تصویری برای رسید، و مسیرهای متن، صوت یا پیام پشتیبانی‌نشده.

`handleCallbackQuery()` برای دکمه‌های inline استفاده می‌شود. ابتدا تلاش می‌کند با `answerCallbackQuery` نشانگر انتظار دکمه را متوقف کند، هویت کاربر را به‌روزرسانی می‌کند و سپس مقدار `query.data` را بررسی می‌کند؛ مثلاً ورود به خرید، انتخاب نوع حساب، انتخاب پلن یا لغو خرید.

ارسال پاسخ به کاربر در هر دو روش با همان شیء `bot` انجام می‌شود. تفاوت polling و webhook مربوط به دریافت update است.

## ۵. تنظیم محیط

برای توسعه با polling:

```dotenv
TELEGRAM_BOT_TOKEN=YOUR_DEV_BOT_TOKEN
TELEGRAM_BOT_MODE=polling
```

برای webhook:

```dotenv
TELEGRAM_BOT_TOKEN=YOUR_PRODUCTION_BOT_TOKEN
TELEGRAM_BOT_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=YOUR_RANDOM_SECRET
```

برای ساخت secret تصادفی می‌توان از این دستور استفاده کرد:

```bash
openssl rand -hex 32
```

secret با توکن بات متفاوت است. قالب مجاز آن ۱ تا ۲۵۶ کاراکتر از حروف انگلیسی، عدد، خط تیره و زیرخط است. آدرس webhook باید HTTPS و فاقد نام کاربری، رمز، query string و fragment باشد.

reverse proxy باید درخواست `POST /telegram/webhook` را به برنامه Nest برساند؛ پورت پیش‌فرض برنامه `3333` است. body و هدر secret باید حفظ شوند. این مسیر با secret تلگرام احراز می‌شود و نباید پشت ورود JWT یا Basic Auth قرار بگیرد.

اگر proxy به مسیر عمومی پیشوند اضافه می‌کند، آدرس کامل عمومی را در متغیر URL بنویس و مسیر را در proxy به `/telegram/webhook` برنامه نگاشت کن. تغییر URL در تنظیمات، مسیر کنترلر Nest را تغییر نمی‌دهد.

بعد از تنظیم متغیرها برنامه را restart کن؛ ثبت webhook در startup خودکار است. برای برگشت به polling، مقدار mode را `polling` کن و دوباره برنامه را اجرا کن. حذف متغیر mode هم polling را انتخاب می‌کند.

برای محیط توسعه و production از توکن‌های جدا استفاده کن: اجرای polling با توکن production، webhook همان بات را حذف می‌کند.

## ۶. خطا، تکرار پیام و توقف برنامه

در webhook، خطایی که از handler خارج شود باعث پاسخ ناموفق می‌شود تا امکان تلاش مجدد تحویل وجود داشته باشد. اما خطاهایی که handlerهای فعلی خودشان catch می‌کنند، لزوماً به درخواست HTTP منتقل نمی‌شوند؛ مثلاً `sendMessage` فعلی خطای ارسال را لاگ می‌کند و `null` برمی‌گرداند.

در پیاده‌سازی فعلی صف پایدار یا جلوگیری پایدار از پردازش update تکراری وجود ندارد. `update_id` فقط اعتبارسنجی می‌شود و برای حذف تکراری‌ها ذخیره نمی‌شود. بنابراین نباید تحویل دقیقاً یک‌باره را فرض کرد؛ اگر بخشی از عملیات انجام شود و سپس خطا رخ دهد، تلاش بعدی ممکن است همان بخش را دوباره اجرا کند.

متد `onModuleDestroy()` مقدار ready را false می‌کند و اگر polling فعال باشد آن را متوقف می‌کند. webhook ثبت‌شده را حذف نمی‌کند. اجرای این hook نیازمند بسته شدن برنامه از مسیر lifecycle Nest است؛ در `main.ts` فعلی `enableShutdownHooks()` فعال نشده، پس نباید فرض کرد هر سیگنال سیستم‌عامل حتماً این متد را اجرا می‌کند.

sessionها در `TelegramSessionService` داخل یک `Map` در حافظه نگهداری می‌شوند و با restart از بین می‌روند. فعلاً یک instance برنامه اجرا کن. مقدار `max_connections: 1` جایگزین session مشترک، صف یا جلوگیری از تکرار عملیات نیست؛ اجرای چند replica نیازمند طراحی این موارد است.

## ۷. بررسی بعد از راه‌اندازی

1. لاگ `Telegram bot started in webhook mode.` را بررسی کن.
2. مطمئن شو مسیر عمومی HTTPS به کنترلر برنامه می‌رسد.
3. از تلگرام `/start` بفرست و سپس یک دکمه منو را امتحان کن تا هر دو مسیر message و callback بررسی شوند.
4. برای خطاهای `401` مقدار secret و عبور هدر از proxy را بررسی کن؛ برای `404` روش فعال و نگاشت مسیر را بررسی کن؛ برای `503` آماده بودن بات و وجود توکن را بررسی کن.

تست‌های `telegramTransport.spec.ts` تنظیمات، انتخاب روش، secret و انتقال خطای handler را بررسی می‌کنند. تست‌های `telegramPurchaseNavigation.spec.ts` رفتار مسیر خرید را پوشش می‌دهند. این تست‌ها جایگزین بررسی اتصال واقعی تلگرام و آدرس عمومی پس از deploy نیستند.
