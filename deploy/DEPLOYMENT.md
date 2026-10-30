# راهنمای کامل ترابوت با Docker: سیستم توسعه و سرور

این سند توضیح می‌دهد که سه پروژه‌ی ترابوت چطور داخل Docker اجرا می‌شوند، یک نسخه‌ی تازه چطور از سیستم توسعه به سرور می‌رود، و برای راه افتادن روی سرور (از DNS دامنه تا HTTPS و VPN) چه باید کرد.

- **سه پروژه:** `transport_backend`، `tarabari_backend` (پوشه‌ی ` trabari -backend`) و `transport_front`.
- **فایل‌های Docker:** همه در `transport_backend/deploy/` هستند.

---

## ۱. تصویر کلی

```
                               اینترنت
                                  │
              کاربر: https://trabot.ir  (DNS ← IP سرور)
                                  │
                          پورت ۸۰ و ۴۴۳ سرور
                                  │
┌─────────────────────────────── سرور (Docker) ───────────────────────────────┐
│                                                                              │
│   web (Caddy + فایل‌های ساخته‌شده‌ی transport_front)                          │
│     ├── /                → صفحه‌های پنل (React، از خود Caddy)                │
│     ├── /api/…           → transport:3006                                    │
│     ├── /socket.io/…     → transport:3006   (اعلان‌های زنده، دستیار)          │
│     ├── /uploads، /cdn   → transport:3006                                    │
│     └── /tarabari-api/…  → tarabari:3001    (/api/… همان سرویس)              │
│                                                                              │
│   transport ─┬─ postgres (Transport)      tarabari ─┬─ postgres (Tarabari)   │
│              ├─ redis                               ├─ rabbitmq              │
│              ├─ rabbitmq ◄─────────────────────────┘                        │
│              ├─ ollama (bge-m3)                     └─ ollama                │
│              ├─ goomni (ایتا)                                                │
│              └─ gluetun ══ تونل VPN ══► تلگرام، واتساپ، OpenAI               │
│                                                                              │
│   backup: هر شب ← پشتیبان دیتابیس‌ها و نشست ایتا                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **از اینترنت:** فقط پورت‌های ۸۰ و ۴۴۳ (Caddy) باز است.
- **سرویس‌های داخلی:** بقیه فقط داخل شبکه‌ی خصوصی Docker همدیگر را با اسم صدا می‌زنند، مثل `postgres`، `transport` و `gluetun`.

---

## ۲. Docker در این پروژه چطور کار می‌کند

### ایمیج و کانتینر

- **ایمیج:** یک بسته‌ی آماده و تغییرناپذیر از برنامه، همراه همه‌ی چیزهایی که لازم دارد: Node.js با نسخه‌ی دقیق، بسته‌های npm، کد ساخته‌شده و ffmpeg.
- **کانتینر:** یک نمونه‌ی در حال اجرا از ایمیج.

یک ایمیج روی سیستم توسعه و روی سرور دقیقاً یک‌جور اجرا می‌شود. دیگر «روی سیستم من کار می‌کرد» پیش نمی‌آید.

| ایمیج | از کدام پروژه | داخلش چیست | Dockerfile |
|---|---|---|---|
| `trabot/transport` | `transport_backend` | Node 20.20.2، `node_modules`، `dist` (کد NestJS ساخته‌شده)، ffmpeg، فایل‌های JSON و prompt دستیار | `transport_backend/Dockerfile` |
| `trabot/tarabari` | `tarabari_backend` | همین‌ها برای Tarabari | `tarabari_backend/Dockerfile` |
| `trabot/web` | `transport_front` | Caddy + خروجی `npm run build` فرانت (HTML، JS و CSS) | `transport_front/Dockerfile` |

بقیه‌ی سرویس‌ها از ایمیج‌های آماده استفاده می‌کنند: Postgres با pgvector، Redis، RabbitMQ، Ollama، goomni، Gluetun، gost (SOCKS5) و registry.

### فرانت (`transport_front`) چطور در Docker است

ساخت ایمیج `web` دو مرحله دارد:
1. **ساخت:** در یک کانتینر Node، `npm ci` و بعد `npm run build` (یعنی `tsc && vite build`) اجرا می‌شود و خروجی در `dist/` قرار می‌گیرد.
2. **اجرا:** فقط همان `dist/` داخل ایمیج کوچک Caddy کپی می‌شود (حدود ۱۰۰ مگابایت). Node و Vite در ایمیج نهایی نیستند.

روی سرور Vite اجرا نمی‌شود. Caddy خود فایل‌ها را به مرورگر می‌دهد و همان کاری را که Vite در توسعه می‌کرد (فرستادن `/api` و `/socket.io` و `/tarabari-api` به بک‌اندها) طبق `deploy/Caddyfile` انجام می‌دهد.

قانون cache در Caddy:
- فایل‌های `/assets/…` اسمشان شامل hash محتوا است، پس یک سال cache می‌شوند.
- بقیه (صفحه، service workerها، manifest) هر بار بررسی می‌شوند تا نسخه‌ی تازه فوراً به کاربر برسد.

### چیزهایی که داخل ایمیج نیستند

ایمیج فقط کد است. هر چه مخصوص یک دستگاه یا محرمانه است از بیرون به کانتینر وصل می‌شود (volume):

| چه | کجای کانتینر | از کجای دستگاه |
|---|---|---|
| `.env` هر بک‌اند (توکن‌ها، کلیدها) | `/app/.env` | `TRANSPORT_ENV`، `TARABARI_ENV` در `deploy/.env` |
| کلیدهای JWT | `/app/keys` | `TRANSPORT_KEYS`، `TARABARI_KEYS` |
| فایل‌های آپلودی | `/app/uploads`، `/app/private-uploads` | `TRANSPORT_UPLOADS`، … |
| اطلاعات دیتابیس، Redis، RabbitMQ، Ollama، ایتا، گواهی HTTPS | volumeهای Docker | `pgdata`، `ollama`، `goomni-data`، `caddy_data`، … |

پاک کردن یا عوض کردن کانتینرها اطلاعات را از بین نمی‌برد. اطلاعات در volumeها می‌ماند.

### تنظیمات: کدام فایل چه کاری می‌کند

| فایل | کار | در git؟ |
|---|---|---|
| `deploy/docker-compose.yml` | همه‌ی سرویس‌ها و ارتباطشان؛ **روی هر دو دستگاه یکی است** | بله |
| `deploy/docker-compose.gpu.yml` | Ollama روی کارت گرافیک (فقط دستگاهی که GPU دارد) | بله |
| `deploy/Caddyfile` | دامنه، HTTPS و مسیرها | بله |
| `deploy/.env` | **تنها تفاوت دو دستگاه:** دامنه، رمزها، مسیرها، GPU، MTU، profileها | نه (محرمانه) |
| `.env` هر بک‌اند | توکن‌ها و تنظیمات خود برنامه | نه |

آدرس‌هایی که داخل Docker فرق می‌کنند در خود compose تنظیم شده‌اند و بر `.env` بک‌اندها مقدم‌اند:
- `DB_HOST=postgres`، `REDIS_HOST=redis`، `RABBITMQ_URL`
- `OLLAMA_URL`، `OUTBOUND_PROXY_URL`
- `TELEGRAM_BOT_MODE=polling`

### profileها: سرویس‌هایی که فقط بعضی‌جاها روشن‌اند

`COMPOSE_PROFILES` در `deploy/.env`:

| profile | سرویس | سیستم توسعه | سرور |
|---|---|---|---|
| `vpn` | `gluetun` + `socks5` | وقتی کانفیگ VPN جدای این سیستم را گذاشتید | ✅ |

### نسخه‌ها

هر بار `./release.sh` ایمیج‌ها را با یک شماره‌ی نسخه می‌سازد: تاریخ + commit، مثلاً `20261030-1931-defc1d2`.
- **سیستم توسعه:** همیشه `latest` (آخرین ساخته‌شده) را اجرا می‌کند.
- **سرور:** `ship.sh` روی خود سرور، از همان commitهایی که push کرده‌اید، ایمیج‌ها را با یک شماره‌ی نسخه می‌سازد و آن را در `TAG` فایل `deploy/.env` سرور می‌گذارد.

---

## ۳. برنامه‌ها چطور اجرا می‌شوند

| سرویس | اجرا | پورت داخلی | از بیرون |
|---|---|---|---|
| `web` | Caddy | ۸۰، ۴۴۳ | **۸۰ و ۴۴۳ (تنها پورت‌های عمومی)** |
| `transport` | `node dist/main` (NestJS) | ۳۰۰۶ | فقط از راه Caddy |
| `tarabari` | `node dist/main` (NestJS) | ۳۰۰۱ | فقط از راه Caddy |
| `postgres` | Postgres 16 + pgvector | ۵۴۳۲ | `127.0.0.1:5433` (فقط خود دستگاه، برای DBeaver) |
| `redis` | Redis 7.4 | ۶۳۷۹ | — |
| `rabbitmq` | RabbitMQ 3.13 | ۵۶۷۲ | صفحه‌ی مدیریت `127.0.0.1:15673` |
| `ollama` | Ollama 0.31.1 | ۱۱۴۳۴ | — |
| `goomni` | درگاه ایتا | ۳۰۰۰ | `127.0.0.1:3000` (صفحه‌ی مدیریت) |
| `gluetun` | تونل VPN + پراکسی HTTP | ۸۸۸۸ | — |
| `socks5` | پراکسی SOCKS5 داخل تونل | ۱۰۸۰ | — |
| `backup` | پشتیبان شبانه | — | — |

- **ترتیب روشن شدن:** بک‌اندها صبر می‌کنند تا Postgres، Redis و RabbitMQ سالم شوند.
- **روشن ماندن:** همه‌ی سرویس‌ها `restart: unless-stopped` دارند. اگر برنامه‌ای خطا بدهد و بسته شود یا دستگاه ری‌استارت شود، Docker خودش دوباره روشنشان می‌کند.
- **لاگ‌ها:** چرخشی‌اند؛ هر سرویس حداکثر ۵ فایل ۲۰ مگابایتی.

### رفت‌وآمد با بیرون (کدام از VPN، کدام مستقیم)

| سرویس | مسیر |
|---|---|
| ربات تلگرام، پایش کانال‌های تلگرام (Tarabari) | `gluetun` (تونل VPN) |
| واتساپ (هر دو بک‌اند) | `gluetun` |
| OpenAI (چت، صدا به متن) | `gluetun` |
| اعلان گوشی (سرورهای گوگل، موزیلا و اپل) | `gluetun` |
| دانلود مدل‌های Ollama | `gluetun` |
| بله، روبیکا، ایتا، ملی‌پیامک، نشان | مستقیم |
| کاربرانی که سایت را باز می‌کنند | مستقیم به Caddy |

- **خود دستگاه VPN ندارد.** تونل فقط داخل کانتینر `gluetun` است.
- **اگر VPN قطع شود:** فقط تلگرام، واتساپ و OpenAI موقتاً کار نمی‌کنند. Gluetun اجازه نمی‌دهد آن سرویس‌ها بدون VPN بیرون بروند، و بقیه‌ی برنامه سالم می‌ماند.
- **چطور در کد:** بک‌اندها از `OUTBOUND_PROXY_URL` (`http://gluetun:8888`) استفاده می‌کنند. پایش کانال‌های تلگرام از `OUTBOUND_SOCKS_URL` (`socks5://gluetun:1080`) استفاده می‌کند، چون پروتکل خود تلگرام فقط SOCKS می‌گیرد.
- **پیام‌رسان‌ها:** ربات تلگرام روی سرور در حالت polling است. سرورهای تلگرام از خارج نمی‌توانند به سرور ایران وصل شوند، برای همین سرور خودش از راه VPN سراغ تلگرام می‌رود. ایتا از راه goomni (داخل همان شبکه‌ی Docker) پیام‌ها را می‌گیرد.

---

## ۴. روند کار: از کد تا سرور

```
سیستم توسعه                                              سرور
───────────                                              ────
کد را تغییر می‌دهید
   │
./release.sh + docker compose up -d   ← اینجا ساخته و تست می‌شود
   │
تأیید ← commit ← git push  ───► GitHub
   │                               │
./ship.sh deploy@server ─────────► سرور همان commitها را از GitHub می‌گیرد
                                   │
                                   ایمیج‌ها را خودش می‌سازد (اینترنت سریع)
                                   TAG در deploy/.env ← up ← migrations
                                   │
                                   نسخه‌ی تازه اجرا می‌شود
```

- **سرور دقیقاً همان commitها را می‌سازد** که اینجا تست و push کرده‌اید. `ship.sh` اگر تغییر commitنشده یا commit pushنشده ببیند، کاری نمی‌کند. جزئیات: `deploy/SERVER-BUILD.md`.
- **چرا ساخت روی سرور:** آپلود این سیستم به سرور حدود ۰٫۲ مگابایت در ثانیه است (ایمیج‌ها ۴٫۵ گیگابایت، یعنی ساعت‌ها). سرور npm، دبیان و Docker Hub را مستقیم و سریع می‌گیرد و هر ساخت چند دقیقه طول می‌کشد.
- **برگشت به نسخه‌ی قبل:** `./ship.sh deploy@server <نسخه‌ی قبلی>`. ایمیج‌های قبلی روی سرور می‌مانند و چیزی دوباره ساخته نمی‌شود.
- **migrationها:** دیتابیس با هر `ship.sh` خودکار به‌روز می‌شود.

---

## ۵. راه‌اندازی سرور، قدم‌به‌قدم

### ۵.۱ پیش‌نیازها

| چیز | حداقل | پیشنهادی |
|---|---|---|
| سیستم‌عامل | Ubuntu 22.04 یا 24.04 | Ubuntu 24.04 |
| رم | ۴ گیگابایت | ۸ گیگابایت |
| پردازنده | ۲ هسته | ۴ هسته |
| دیسک | ۴۰ گیگابایت | ۸۰ گیگابایت (ایمیج‌ها، پشتیبان‌ها، آپلودها) |
| IP | یک IP ثابت عمومی | — |
| Docker | نصب‌شده با `docker compose` | — |
| دامنه | مثلاً `trabot.ir` | — |
| VPN | یک کانفیگ WireGuard یا OpenVPN **جدا** برای سرور | — |

### ۵.۲ دسترسی SSH با کلید (یک بار، از سیستم توسعه)

```bash
ssh-keygen -t ed25519            # اگر کلید ندارید
ssh-copy-id user@IP_سرور
ssh user@IP_سرور                 # باید بدون رمز وارد شوید
```

`ship.sh` و `pull-backups.sh` از همین دسترسی استفاده می‌کنند.

روی سرور، کاربر را عضو گروه docker کنید و یک بار خارج و دوباره وارد شوید:

```bash
sudo usermod -aG docker $USER
```

### ۵.۳ mirror برای Docker Hub

Docker Hub به IPهای ایران ایمیج نمی‌دهد. روی سرور:

```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://docker.arvancloud.ir"] }
EOF
sudo systemctl restart docker
docker pull hello-world        # آزمایش
```

اگر این mirror کار نکرد، یکی از mirrorهای دیگر ایرانی را امتحان کنید. ایمیج‌های خود ترابوت (`transport`، `tarabari`، `web`) را `ship.sh` روی همین سرور از کد GitHub می‌سازد.

### ۵.۴ دامنه و DNS

DNS به مرورگر می‌گوید `trabot.ir` روی کدام IP است. باید در پنل جایی که DNS دامنه را مدیریت می‌کند (مثلاً آروان‌کلاد، کلادفلر، یا پنل ثبت‌کننده‌ی دامنه) رکورد بسازید.

**رکوردها:**

| نوع | نام | مقدار | TTL |
|---|---|---|---|
| `A` | `@` (خود `trabot.ir`) | IP عمومی سرور، مثلاً `185.x.x.x` | ۱۰ دقیقه |
| `A` | `www` | همان IP | ۱۰ دقیقه |

**چند نکته‌ی مهم:**
- **AAAA:** اگر سرور IPv6 ندارد، رکورد `AAAA` نسازید. اگر از قبل هست و به جای دیگری اشاره می‌کند، پاکش کنید. مرورگرها اول IPv6 را امتحان می‌کنند.
- **پروکسی CDN:** اگر DNS در آروان یا کلادفلر است، فعلاً **پروکسی/CDN را خاموش بگذارید** (حالت «فقط DNS»، ابر خاکستری). Caddy برای گرفتن گواهی HTTPS باید مستقیم از اینترنت روی پورت ۸۰ در دسترس باشد. بعد از راه افتادن می‌شود CDN را روشن کرد.
- **TTL کوتاه:** اول کار TTL کوتاه (مثلاً ۱۰ دقیقه) بگذارید تا اگر IP عوض شد زود اعمال شود. بعداً می‌شود آن را بلند کرد.
- **بررسی:** از سیستم خودتان بزنید:
  ```bash
  dig +short trabot.ir
  dig +short www.trabot.ir
  ```
  هر دو باید IP سرور را بدهند. اعمال تغییر DNS از چند دقیقه تا چند ساعت طول می‌کشد.

**در `deploy/.env` سرور:**

```
SITE_ADDRESS=trabot.ir, www.trabot.ir
```

**HTTPS:** Caddy بعد از اولین روشن شدن خودش گواهی Let's Encrypt را برای این دامنه‌ها می‌گیرد و هر دو ماه یک بار تمدید می‌کند. کار دستی لازم نیست.

اگر گرفتن گواهی شکست خورد، علتش معمولاً یکی از این‌هاست:
- DNS هنوز به IP سرور نرسیده است.
- پورت ۸۰ بسته است.
- اتصال بین‌المللی ورودی به سرور محدود شده است (در زمان اختلال‌های اینترنت ایران پیش می‌آید).

لاگش را با `docker compose logs web` ببینید. اگر Let's Encrypt از ایران مشکل داشت، راه جایگزین این است که CDN آروان روشن شود و گواهی را خود آروان بدهد.

**تا دامنه آماده نشده:** `SITE_ADDRESS=:80` بگذارید. پنل با `http://IP_سرور` باز می‌شود، ولی اعلان گوشی و نصب برنامه (PWA) بدون HTTPS کار نمی‌کنند.

### ۵.۵ فایروال

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp      # HTTP/3
sudo ufw enable
```

سرویس‌های دیگر روی `127.0.0.1` باز شده‌اند و از بیرون در دسترس نیستند، حتی اگر فایروال خاموش باشد.

### ۵.۶ پوشه و فایل‌ها

**روی سرور:**

```bash
sudo mkdir -p /opt/trabot && sudo chown $USER /opt/trabot
```

**از سیستم توسعه:** فایل‌های `deploy/` را یک بار بفرستید (`ship.sh` هم با هر اجرا همین کار را می‌کند):

```bash
cd ~/Transport/transport_backend/deploy && rsync -a --exclude .env --exclude config/ --exclude data/ --exclude 'vpn/wireguard/*.conf' ./ deploy@IP_سرور:/opt/trabot/deploy/
```

**روی سرور، `/opt/trabot/deploy/.env`** را از `.env.example` بسازید:

```bash
cd /opt/trabot/deploy && cp .env.example .env && chmod 600 .env && nano .env
```

| تنظیم | مقدار روی سرور |
|---|---|
| `SITE_ADDRESS` | `trabot.ir, www.trabot.ir` |
| `COMPOSE_PROFILES` | `vpn` |
| `COMPOSE_FILE` | `docker-compose.yml` (GPU ندارد) |
| `NETWORK_MTU` | `1500` |
| `DB_PASSWORD`، `RABBITMQ_PASSWORD` | رمزهای قوی و تازه (بدون `$`) |
| `VPN_TYPE` | `wireguard` یا `openvpn` |
| مسیرها (`TRANSPORT_ENV`، …) | همان پیش‌فرض‌ها (`./config/…`، `./data/…`) |

**فایل‌های `config/`:** از سیستم توسعه کپی کنید.

```bash
# سیستم توسعه
ssh user@server 'mkdir -p /opt/trabot/deploy/config/transport-keys /opt/trabot/deploy/config/tarabari-keys'
scp ~/Transport/transport_backend/.env                         user@server:/opt/trabot/deploy/config/transport.env
scp "/home/hamed/ trabari -backend/.env"                        user@server:/opt/trabot/deploy/config/tarabari.env
scp ~/Transport/transport_backend/keys/*                       user@server:/opt/trabot/deploy/config/transport-keys/
scp "/home/hamed/ trabari -backend/keys/jwt-public.pem"        user@server:/opt/trabot/deploy/config/tarabari-keys/
scp ~/Transport/transport_backend/deploy/config/goomni.env     user@server:/opt/trabot/deploy/config/
```

**تغییرهای لازم در `config/transport.env` و `config/tarabari.env` سرور:**

| تنظیم | مقدار | چرا |
|---|---|---|
| `SMS_OTP_ENABLED` | **`true`** | **حیاتی:** با `false` هر کدی قبول می‌شود، یعنی هر کس با هر شماره‌ای وارد می‌شود |
| `MELIPAYAMAK_OTP_BODY_ID` | کد الگوی تأییدشده‌ی ورود | پیامک ورود (لینک دامنه آخر متن الگو) |
| `MELIPAYAMAK_INVITE_BODY_ID` | کد الگوی تأییدشده‌ی دعوت | پیامک دعوت: `{0}` دعوت‌کننده، `{1}` مسیر لینک؛ دامنه ثابت آخر متن الگو |
| `WEB_PANEL_URL` | `https://trabot.ir` | لینک‌های پیامک و پیام‌رسان‌ها |
| `API_MAIN_URL` | `https://trabot.ir` | |
| `CORS_ORIGIN` | `https://trabot.ir,https://www.trabot.ir` | |
| `GOOGLE_REDIRECT_URI` | با دامنه‌ی جدید | ورود با گوگل |
| `EITAA_GOOMNI_URL` | `http://goomni:3000/…` | همین الان روی سیستم توسعه همین است |
| `EITAA_WEBHOOK_URL` | `http://transport:3006/…` | همین‌طور |
| `LLM_LOCAL_FALLBACK` | `off` | مدل متنی محلی روی سرور نیست |
| `VAPID_SUBJECT` | `mailto:` یا آدرس سایت | اعلان گوشی |

**VPN:** کانفیگ جدای سرور را بگذارید.

```bash
scp wg0.conf user@server:/opt/trabot/deploy/vpn/wireguard/wg0.conf      # WireGuard
# یا: custom.ovpn در vpn/openvpn/ و VPN_TYPE=openvpn
```

**پوشه‌های اطلاعات:**

```bash
cd /opt/trabot/deploy
mkdir -p data/transport/uploads data/transport/private-uploads data/transport/cdn data/tarabari/uploads data/tarabari/cdn data/backups
sudo chown -R 1000:1000 data
```

### ۵.۷ انتقال اطلاعات

**دیتابیس‌ها:** migrationهای Tarabari از صفر کامل اجرا نمی‌شوند، پس حتماً از پشتیبان بیاورید.

```bash
# سیستم توسعه: آخرین پشتیبان شبانه، یا یکی تازه
cd ~/Transport/transport_backend/deploy && docker compose exec backup /backup.sh now
D=$(ls -d data/backups/20* | tail -1)
scp "$D"/Transport.dump "$D"/Tarabari.dump "$D"/goomni-data.tgz user@server:/opt/trabot/

# سرور
cd /opt/trabot/deploy && docker compose up -d postgres
docker compose cp ../Transport.dump postgres:/tmp/ && docker compose cp ../Tarabari.dump postgres:/tmp/
docker compose exec postgres pg_restore -U postgres -d Transport --no-owner /tmp/Transport.dump
docker compose exec postgres pg_restore -U postgres -d Tarabari --no-owner /tmp/Tarabari.dump
```

**نشست ایتا:**

```bash
docker volume create goomni-data
docker run --rm -v goomni-data:/d -v /opt/trabot:/b alpine tar -xzf /b/goomni-data.tgz -C /d
```

**فایل‌های آپلودی:**

```bash
# سیستم توسعه
rsync -a ~/Transport/transport_backend/uploads/          user@server:/opt/trabot/deploy/data/transport/uploads/
rsync -a ~/Transport/transport_backend/private-uploads/  user@server:/opt/trabot/deploy/data/transport/private-uploads/
rsync -a "/home/hamed/ trabari -backend/uploads/"        user@server:/opt/trabot/deploy/data/tarabari/uploads/
rsync -a ~/Transport/transport_backend/cdn/              user@server:/opt/trabot/deploy/data/transport/cdn/
rsync -a "/home/hamed/ trabari -backend/cdn/"            user@server:/opt/trabot/deploy/data/tarabari/cdn/
```

`uploads` روی سیستم توسعه ۴ گیگابایت است و بخش زیادی از آن احتمالاً فایل‌های آزمایشی و مدل‌های whisper است. قبل از انتقال ببینید چه چیزی لازم است.

### ۵.۸ قطع پیام‌رسان‌ها روی سیستم توسعه

**قبل از** روشن کردن سرور: یک ربات تلگرام، بله یا روبیکا، یک شماره‌ی واتساپ یا یک حساب ایتا **نباید هم‌زمان روی دو دستگاه** روشن باشد. همدیگر را قطع می‌کنند و واتساپ ممکن است شماره را ببندد. پس روی سیستم توسعه یکی از این دو کار را بکنید:
- **حساب‌های تستی جدا بگیرید:** ربات تستی تلگرام و بله، شماره‌ی تستی واتساپ و حساب تستی ایتا. این راه بهتر است.
- **یا پیام‌رسان‌ها را خاموش کنید:** توکن‌ها را در `.env` سیستم توسعه خالی کنید و `docker compose stop goomni` بزنید.

### ۵.۹ روشن کردن

از سیستم توسعه:

```bash
cd ~/Transport/transport_backend/deploy && ./ship.sh deploy@IP_سرور
```

روی سرور، فقط بار اول:

```bash
cd /opt/trabot/deploy
docker compose exec ollama ollama pull bge-m3
docker compose ps                      # همه Up، و postgres/redis/rabbitmq/backup ‏healthy
```

### ۵.۱۰ بررسی‌ها

| بررسی | دستور یا کار | نتیجه‌ی درست |
|---|---|---|
| HTTPS | باز کردن `https://trabot.ir` | پنل با قفل سبز |
| گواهی | `docker compose logs web \| grep -i certificate` | «certificate obtained» |
| VPN | `docker compose logs gluetun \| tail -20` | «connected» / «healthy» |
| تلگرام از VPN | پیام به ربات تلگرام | جواب می‌دهد |
| تلگرام مستقیم بسته است | دستور اول بخش «بررسی VPN» در `README.md` | «blocked» |
| واتساپ، بله، روبیکا، ایتا | پیام به هر کدام | جواب می‌دهند |
| ورود با پیامک | ورود در پنل | پیامک واقعی می‌رسد |
| دستیار هوشمند | یک سؤال در دستیار | جواب و اجرای ابزار |
| پشتیبان | `ls data/backups` فردا صبح | یک پوشه‌ی تاریخ‌دار |

اگر Gluetun گفت Endpoint باید IP باشد، در `wg0.conf` به‌جای نام سرور VPN (مثلاً `s4.justcom.top`)، IP آن را بگذارید:

```bash
getent hosts s4.justcom.top
```

---

## ۶. کارهای روزمره

### روی سیستم توسعه

```bash
cd ~/Transport/transport_backend/deploy
./release.sh                      # بعد از هر تغییر کد (یا ./release.sh transport برای یکی)
docker compose up -d              # اجرای نسخه‌ی تازه اینجا
docker compose logs -f transport  # لاگ
./ship.sh deploy@server           # ساخت commitهای pushشده روی سرور و اجرا
./pull-backups.sh user@server     # کپی پشتیبان‌های سرور (مثلاً روزانه با cron)
```

پنل: `http://localhost` · Postgres: `localhost:5433` · RabbitMQ: `http://localhost:15673` · goomni: `http://localhost:3000`

### روی سرور

```bash
cd /opt/trabot/deploy
docker compose ps                       # وضعیت
docker compose logs -f transport        # لاگ زنده
docker compose restart transport        # ری‌استارت یک سرویس
docker compose exec backup /backup.sh now   # پشتیبان همین الان
```

**دسترسی به دیتابیس یا RabbitMQ سرور از سیستم خودتان** با تونل SSH:

```bash
ssh -L 5434:127.0.0.1:5433 -L 15674:127.0.0.1:15673 user@server
# DBeaver: localhost:5434 · RabbitMQ: http://localhost:15674
```

### برگشت به نسخه‌ی قبل

```bash
./ship.sh deploy@server 20261030-1821-defc1d2      # یک نسخه‌ی قبلی (روی سرور ساخته شده باشد)
```

اگر نسخه‌ی جدید migration داشته، برگشت کد کافی نیست و ممکن است لازم باشد دیتابیس هم از پشتیبان برگردد. پس قبل از `ship.sh` نسخه‌هایی که migration دارند، روی سرور یک `backup.sh now` بزنید.

---

## ۷. پشتیبان‌گیری

- **سرویس `backup`:** هر شب ساعت `BACKUP_AT` (پیش‌فرض ۳:۳۰) پشتیبان می‌گیرد، در `data/backups/<تاریخ>/`:
  - `Transport.dump` و `Tarabari.dump` (هر کدام بلافاصله بررسی می‌شود که قابل بازگرداندن باشد)
  - `goomni-data.tgz` (نشست ایتا)
- **نگهداری:** ۱۴ روز آخر.
- **هشدار:** اگر ۲۶ ساعت پشتیبان موفقی گرفته نشود، `docker compose ps` سرویس را `unhealthy` نشان می‌دهد.
- **فایل‌های آپلودی:** در پشتیبان شبانه نیستند. با `rsync` جدا کپی بگیرید.
- **کپی بیرون از سرور:** پشتیبانی که فقط روی همان سرور باشد، با خراب شدن سرور از بین می‌رود. `./pull-backups.sh user@server` را روی سیستم توسعه مرتب اجرا کنید.

بازگرداندن: بخش «پشتیبان‌گیری ← بازگرداندن» در `README.md`.

---

## ۸. عیب‌یابی

| مشکل | علت محتمل | راه حل |
|---|---|---|
| `docker pull` از سرور timeout | Docker Hub مسدود | mirror در `/etc/docker/daemon.json` (۵.۳) |
| HTTPS نمی‌آید | DNS هنوز نرسیده، پورت ۸۰ بسته، CDN روشن | `dig`، فایروال، CDN را خاموش کنید (۵.۴) |
| تلگرام، واتساپ یا OpenAI جواب نمی‌دهند | VPN وصل نیست | `docker compose logs gluetun`؛ کانفیگ جدا؟ Endpoint به‌صورت IP؟ |
| ربات‌ها مدام قطع و وصل می‌شوند | یک حساب روی دو دستگاه | ۵.۸ |
| `transport` مدام ری‌استارت می‌شود | `.env` یا کلید JWT جا افتاده، دیتابیس خالی | `docker compose logs transport` |
| دستیار ابزار انتخاب نمی‌کند | مدل `bge-m3` در Ollama نیست | `docker compose exec ollama ollama pull bge-m3` |
| `backup` در وضعیت unhealthy | پشتیبان شکست خورده یا دیسک پر است | `docker compose logs backup`، `df -h` |
| روی سیستم توسعه دانلودها گیر می‌کنند | VPN کل سیستم با MTU ۱۴۲۰ | `NETWORK_MTU=1380` (تنظیم شده است) |
| ورود با هر کدی قبول می‌شود | `SMS_OTP_ENABLED=false` | روی سرور حتماً `true` |

---

## ۹. فهرست نهایی راه‌اندازی سرور

- [ ] SSH با کلید از سیستم توسعه
- [ ] کاربر سرور در گروه docker
- [ ] mirror برای Docker Hub
- [ ] رکوردهای `A` دامنه به IP سرور (بدون `AAAA` نادرست، CDN خاموش)
- [ ] فایروال: ۲۲، ۸۰، ۴۴۳
- [ ] `/opt/trabot/deploy/.env` (دامنه، رمزهای تازه، `COMPOSE_PROFILES=vpn`)
- [ ] `config/`: `transport.env`، `tarabari.env`، کلیدها، `goomni.env`
- [ ] در `.env` سرور: `SMS_OTP_ENABLED=true`، آدرس‌های دامنه، `LLM_LOCAL_FALLBACK=off`
- [ ] کانفیگ VPN جدای سرور در `vpn/`
- [ ] پوشه‌های `data/` با مالکیت ۱۰۰۰
- [ ] دیتابیس‌ها، نشست ایتا و آپلودها منتقل شدند
- [ ] پیام‌رسان‌های سیستم توسعه خاموش شدند یا حساب تستی گرفتند
- [ ] `./ship.sh deploy@server`
- [ ] `ollama pull bge-m3`
- [ ] بررسی‌های بخش ۵.۱۰
- [ ] cron برای `pull-backups.sh` روی سیستم توسعه
