# راه‌اندازی ربات ایتا (GoOmni)

ربات ایتای ترابوت یک **حساب معمولی ایتا** است که در [GoOmni](https://github.com/mimalef70/goomni) (نسخه‌ی v2.4.1) وارد شده.
GoOmni پیام‌های این حساب را با webhook امضاشده به بک‌اند (`POST /eitaa/webhook`) می‌فرستد و بک‌اند پاسخ‌ها را از REST API آن می‌فرستد.
کد مربوط: `src/services/messengerBot/eitaa/`.

این مراحل هم برای سیستم محلی (تست) است و هم برای سرور production؛ فرق‌ها در بخش آخر آمده.

> **هشدار:** فایل‌های `~/goomni/.env` و `~/goomni/master.key` و رمزهای `.env` بک‌اند را هیچ‌جا نفرستید و پاک نکنید.
> نشست ورود ایتا با `master.key` رمز می‌شود؛ اگر گم شود باید دوباره وارد حساب شوید.
> یک حساب ایتا را هم‌زمان روی دو GoOmni (مثلاً لپ‌تاپ و سرور) روشن نکنید.

---

## ۰. دسترسی به Docker

یک بار اجرا کنید، بعد **log out و دوباره log in** کنید (یا سیستم را ری‌استارت کنید):

```bash
sudo usermod -aG docker $USER
```

باید بدون خطا اجرا شود:

```bash
docker ps
```

## ۱. پوشه و فایل compose

```bash
mkdir -p ~/goomni && cd ~/goomni
curl -LO https://raw.githubusercontent.com/mimalef70/goomni/v2.4.1/docker-compose.yml
```

## ۲. دریافت ایمیج و ساخت تنظیمات اولیه

```bash
export APP_IMAGE='docker.io/mimalef70/goomni:v2.4.1'
docker pull "$APP_IMAGE"
docker run --rm --user "$(id -u):$(id -g)" \
  --volume "$PWD:/config" --workdir /config \
  "$APP_IMAGE" init --bale-web-client
```

دو فایل `.env` و `master.key` ساخته می‌شود.

## ۳. روشن کردن ایتا

```bash
echo 'EITAA_ENABLED=true' >> .env
```

## ۴. اجرا

```bash
export APP_MASTER_KEY="$(cat master.key)"
docker compose up -d --no-build
docker compose logs --tail=100 goomni
```

> در هر ترمینال تازه، پیش از هر دستور `docker compose` این را بزنید، وگرنه خطای `APP_MASTER_KEY is missing` می‌گیرید:
>
> ```bash
> cd ~/goomni && export APP_MASTER_KEY="$(cat master.key)"
> ```

container با `restart: unless-stopped` بعد از ری‌استارت سیستم خودش بالا می‌آید.

## ۵. بررسی

```bash
curl -s http://127.0.0.1:3000/health
grep APP_BASIC_AUTH .env
```

- خروجی اول باید `"status":"ok"` داشته باشد.
- خروجی دوم نام کاربری و رمز پنل است (`user:password`).

GoOmni فقط روی `127.0.0.1:3000` باز است و از بیرون در دسترس نیست. همین درست است.

## ۶. ورود حساب ایتا از پنل

1. در مرورگر `http://127.0.0.1:3000/ui/` را باز کنید و با `APP_BASIC_AUTH` وارد شوید.
   قسمت پیش از `:` نام کاربری است و پس از آن رمز.
2. یک connection تازه بسازید:
   - **Provider:** `eitaa`
   - **Alias:** `tarabot`
   - **شماره:** شماره‌ی حساب ربات
3. کد ورود را که در اپ ایتای همان شماره می‌آید وارد کنید. اگر رمز دومرحله‌ای دارد، آن را هم وارد کنید.
4. صبر کنید تا حساب «متصل» شود.

## ۷. گرفتن instance_id و بررسی وضعیت

```bash
cd ~/goomni
APP_BASIC_AUTH=$(grep '^APP_BASIC_AUTH=' .env | cut -d= -f2-)
curl -s --user "$APP_BASIC_AUTH" http://127.0.0.1:3000/devices \
  | jq '.results[] | {id, provider, instance_id}'
```

وضعیت اتصال (به جای `<INSTANCE_ID>` مقدار بالا را بگذارید):

```bash
curl -s --user "$APP_BASIC_AUTH" \
  -H 'X-Device-Id: tarabot' -H 'X-Device-Instance: <INSTANCE_ID>' \
  http://127.0.0.1:3000/devices/tarabot/status | jq '.results'
```

- باید `"auth": "authenticated"` و `"transport": "connected"` باشد.
- `"recovery": "degraded"` فقط درباره‌ی وارد کردن پیام‌های قدیمیِ پیش از ورود است. ربات فقط پیام‌های تازه را لازم دارد.

> اگر connection را پاک کنید و دوباره بسازید، `instance_id` عوض می‌شود و باید در `.env` بک‌اند هم عوضش کنید.

## ۸. ساخت رمز webhook

```bash
openssl rand -hex 32
```

## ۹. متغیرهای `.env` بک‌اند

به `~/Transport/transport_backend/.env` اضافه کنید:

```env
# Eitaa (GoOmni)
EITAA_GOOMNI_URL=http://127.0.0.1:3000
EITAA_GOOMNI_AUTH=<مقدار APP_BASIC_AUTH از ~/goomni/.env>
EITAA_DEVICE_ID=tarabot
EITAA_DEVICE_INSTANCE=<instance_id از مرحله‌ی ۷>
EITAA_WEBHOOK_SECRET=<خروجی مرحله‌ی ۸>
EITAA_WEBHOOK_URL=http://host.docker.internal:3006/eitaa/webhook
EITAA_ACCOUNT=@tarabot
# فقط برای تست روی حساب شخصی (بخش «تست با حساب شخصی»)
EITAA_ALLOWED_PEERS=none
```

| متغیر | توضیح |
| --- | --- |
| `EITAA_GOOMNI_URL` | آدرس GoOmni از دید بک‌اند |
| `EITAA_GOOMNI_AUTH` | همان `user:password` پنل GoOmni |
| `EITAA_DEVICE_ID` | alias حساب در GoOmni |
| `EITAA_DEVICE_INSTANCE` | `instance_id` همان حساب |
| `EITAA_WEBHOOK_SECRET` | رمز امضای webhook؛ دست‌کم ۱۶ کاراکتر |
| `EITAA_WEBHOOK_URL` | آدرس بک‌اند از دید GoOmni. GoOmni داخل Docker است، پس `host.docker.internal` و پورت بک‌اند (`PORT`). بک‌اند هنگام شروع webhook را خودش روی GoOmni تنظیم می‌کند. |
| `EITAA_ACCOUNT` | چیزی که کاربر در کارت «اتصال ایتا» پروفایل می‌بیند (توضیح در زیر) |
| `EITAA_ALLOWED_PEERS` | اختیاری. شناسه‌های ایتایی (با کاما جدا) که ربات فقط به آن‌ها جواب می‌دهد. خالی یعنی همه. |

### `EITAA_ACCOUNT`

در پروفایل راننده یا شرکت، کارت «اتصال ایتا» می‌گوید: «کد بگیرید و برای حساب ایتای ترابوت … بفرستید».

- **آیدی** (مثل `@tarabot`): به شکل لینک `https://eitaa.com/tarabot` نشان داده می‌شود و کاربر با یک لمس وارد چت ربات می‌شود. آیدی باید با حرف انگلیسی شروع شود و دست‌کم ۴ کاراکتر باشد. آن را در اپ ایتا از مسیر «تنظیمات ← ویرایش پروفایل ← نام کاربری» بسازید.
- **شماره:** فقط متن است و کاربر باید آن را ذخیره یا جستجو کند. شماره هم برای همه آشکار می‌شود.
- **خالی:** کارت اصلاً نشان داده نمی‌شود.

اسم و عکس پروفایل حساب را «ترابوت» بگذارید.

## ۱۰. ری‌استارت بک‌اند

در لاگ باید این خط بیاید:

```
Eitaa bot started; GoOmni webhook set.
```

| پیام لاگ | معنی |
| --- | --- |
| `Eitaa bot is disabled` | یکی از متغیرها خالی است یا رمز webhook کوتاه است |
| `Could not set the Eitaa GoOmni webhook` | بک‌اند به GoOmni نرسید یا `EITAA_GOOMNI_AUTH` / `EITAA_DEVICE_INSTANCE` اشتباه است |
| `Eitaa bot answers only EITAA_ALLOWED_PEERS` | حالت تست روشن است |

## ۱۱. تست رفت‌وبرگشت

1. با یک حساب ایتای **دیگر** به حساب ربات «سلام» بدهید. ربات باید راهنمای اتصال با کد را جواب بدهد.
2. در پنل وب با یک حساب تستی به پروفایل بروید و در کارت «اتصال ایتا» دکمه‌ی «گرفتن کد اتصال» را بزنید.
3. کد ۶ رقمی را در ایتا برای ربات بفرستید. حساب وصل می‌شود و منو می‌آید.

کد ۱۰ دقیقه اعتبار دارد و یک بار مصرف است. بعد از ۵ کد اشتباه، آن حساب ایتا ۱۰ دقیقه باید صبر کند.

اگر پیام اول جوابی نگرفت، احتمالاً GoOmni (داخل Docker) به پورت بک‌اند نمی‌رسد؛ مثلاً فایروال جلویش را گرفته.
تاریخچه‌ی تحویل webhook را ببینید:

```bash
curl -s --user "$APP_BASIC_AUTH" \
  -H 'X-Device-Id: tarabot' -H 'X-Device-Instance: <INSTANCE_ID>' \
  'http://127.0.0.1:3000/deliveries?limit=20' | jq
```

---

## تست با حساب شخصی

اگر GoOmni با شماره‌ی شخصی خودتان وارد شده، بدون قفل:

- ربات به هر کسی که به شما پیام بدهد جواب می‌دهد؛
- پیام‌های شما خودکار «خوانده‌شده» می‌شوند؛
- با مسدود شدن احتمالی، حساب شخصی‌تان از دست می‌رود.

برای همین از `EITAA_ALLOWED_PEERS` استفاده کنید:

1. `EITAA_ALLOWED_PEERS=none` بگذارید و بک‌اند را ری‌استارت کنید. با این مقدار ربات به هیچ‌کس جواب نمی‌دهد.
2. از حساب ایتای تستی به خودتان پیام بدهید. در لاگ بک‌اند می‌آید:
   ```
   Eitaa: left alone a message from 12345678 (not in EITAA_ALLOWED_PEERS).
   ```
3. آن عدد را جای `none` بگذارید (چند حساب را با کاما جدا کنید) و دوباره ری‌استارت کنید:
   ```env
   EITAA_ALLOWED_PEERS=12345678
   ```

پیام بقیه‌ی افراد دست‌نخورده می‌ماند: نه جواب، نه «خوانده‌شده».

بعد از تست، حساب شخصی را از پنل GoOmni (`tarabot`) logout کنید.

## production

- **یک سیم‌کارت جدا فقط برای ربات** بگیرید؛ نه شماره‌ی شخصی.
- همین مراحل را روی سرور تکرار کنید (Docker روی سرور هم لازم است). GoOmni را **فقط** روی `127.0.0.1` نگه دارید و پورت 3000 را باز نکنید.
- `EITAA_ALLOWED_PEERS` را خالی بگذارید یا حذف کنید.
- `EITAA_WEBHOOK_URL` باید به پورت بک‌اند سرور اشاره کند (`http://host.docker.internal:<PORT>/eitaa/webhook`).
- از `~/goomni/.env`، `master.key` و volume `goomni-data` نسخه‌ی پشتیبان امن داشته باشید.
- `SMS_OTP_ENABLED` را روشن کنید. کد اتصال ایتا از پنل وب گرفته می‌شود، پس امنیتش به اندازه‌ی ورود به پنل است.

## محدودیت‌ها (رفتار ربات)

- متن حداکثر ۴۰۹۶ کاراکتر. دکمه‌ها به شکل گزینه‌های شماره‌دار («۱. …») می‌آیند و کاربر شماره را می‌فرستد.
- دکمه‌ی «ارسال شماره» در ایتا نیست؛ اتصال فقط با کد پنل وب است.
- ربات فقط به کسانی پیام می‌دهد که خودشان اول پیام داده‌اند.
- هر چت یک وقفه‌ی ۱٫۲ تا ۲٫۶ ثانیه‌ای دارد و کل حساب حداکثر ۲۰ پیام در دقیقه می‌فرستد. این برای کم کردن احتمال تشخیص ربات است.
- ارسالی که وضعیتش «نامعلوم» شد، دوباره فرستاده نمی‌شود.
