# ترابوت با Docker (سیستم توسعه و سرور)

یک `docker-compose.yml` برای هر دو جا. تنها تفاوت دو دستگاه فایل `deploy/.env` است: مسیرها، دامنه، GPU و MTU.

| سرویس | کار |
|---|---|
| `postgres` | دیتابیس‌های Transport و Tarabari (با pgvector) |
| `redis`، `rabbitmq` | کش و صف بین دو بک‌اند |
| `gluetun` + `socks5` | خروجی VPN، فقط برای تلگرام، واتساپ، OpenAI، اعلان گوشی و دانلود مدل‌ها (`COMPOSE_PROFILES=vpn`) |
| `ollama` | embedding دستیار (`bge-m3`)، و روی سیستم توسعه بقیه‌ی مدل‌ها با GPU |
| `goomni` | درگاه ایتا (نشست حساب ایتا در volume `goomni-data`) |
| `transport`، `tarabari` | دو بک‌اند |
| `web` | پنل وب + Caddy (HTTPS خودکار، مسیرهای `/api`، `/socket.io`، `/tarabari-api`) |
| `backup` | پشتیبان شبانه از هر دو دیتابیس و نشست ایتا |

خود دستگاه VPN سراسری لازم ندارد. تونل فقط داخل کانتینر `gluetun` است و بقیه‌ی ترافیک مستقیم می‌رود.

## روند کار

```
سیستم توسعه: کد ← ./release.sh و docker compose up -d (تست) ← تأیید ← commit و git push
           ← ./ship.sh deploy@server ← سرور همان commitها را از GitHub می‌گیرد، می‌سازد و اجرا می‌کند
```

جزئیات و دلیلش در [SERVER-BUILD.md](SERVER-BUILD.md). برگشت به نسخه‌ی قبل: `./ship.sh deploy@server <نسخه‌ی قبلی>`.

## سیستم توسعه

```bash
cd transport_backend/deploy
./release.sh            # ساخت ایمیج‌ها؛ نسخه را چاپ می‌کند
docker compose up -d    # اجرای همان نسخه
```

- پنل: `http://localhost`
- Postgres: `localhost:5433`
- RabbitMQ: `http://localhost:15673`
- goomni: `http://localhost:3000`

## سرور (یک بار)

1. **Docker و mirror:** Docker Hub به IP ایران ایمیج نمی‌دهد. در `/etc/docker/daemon.json` یک mirror بگذارید و `sudo systemctl restart docker`:
   ```json
   { "registry-mirrors": ["https://docker.arvancloud.ir"] }
   ```
2. **پوشه:** `sudo mkdir -p /opt/trabot && sudo chown $USER /opt/trabot`. فایل‌های `deploy/` با اولین `./ship.sh` می‌روند.
3. **`/opt/trabot/deploy/.env`** را از `.env.example` بسازید:
   - `SITE_ADDRESS`: دامنه
   - `COMPOSE_PROFILES=vpn`
   - `NETWORK_MTU=1500`
   - رمزها (بدون `$`)
4. **`/opt/trabot/deploy/config/`:**
   - `transport.env` و `tarabari.env`: از سیستم توسعه کپی کنید و این‌ها را به دامنه‌ی سرور تغییر دهید: `WEB_PANEL_URL`، `API_MAIN_URL`، `CORS_ORIGIN`، `GOOGLE_REDIRECT_URI`. در هر دو `LLM_LOCAL_FALLBACK=off` بگذارید (مدل متنی محلی روی سرور نیست).
   - `transport-keys/` (هر دو کلید JWT) و `tarabari-keys/jwt-public.pem`
   - `goomni.env` (همان فایل سیستم توسعه)
5. **VPN** با کانفیگ **جدا برای سرور**:
   - WireGuard: `vpn/wireguard/wg0.conf` با `VPN_TYPE=wireguard`
   - OpenVPN: `vpn/openvpn/custom.ovpn` با `VPN_TYPE=openvpn`
6. **پوشه‌ها و فایروال:**
   - `mkdir -p data/transport/uploads data/transport/private-uploads data/transport/cdn data/tarabari/uploads data/tarabari/cdn data/backups && sudo chown -R 1000:1000 data`
   - فقط پورت‌های ۲۲، ۸۰ و ۴۴۳ باز باشند.
7. **اطلاعات** (دیتابیس‌ها خالی‌اند؛ migrationهای Tarabari از صفر کامل اجرا نمی‌شوند، پس حتماً از پشتیبان):
   ```bash
   # سیستم توسعه
   pg_dump -h localhost -p 5433 -U postgres -d Transport -Fc -f Transport.dump
   pg_dump -h localhost -p 5433 -U postgres -d Tarabari -Fc -f Tarabari.dump
   scp Transport.dump Tarabari.dump user@server:/opt/trabot/
   # سرور
   cd /opt/trabot/deploy && docker compose up -d postgres
   docker compose cp ../Transport.dump postgres:/tmp/ && docker compose cp ../Tarabari.dump postgres:/tmp/
   docker compose exec postgres pg_restore -U postgres -d Transport --no-owner /tmp/Transport.dump
   docker compose exec postgres pg_restore -U postgres -d Tarabari --no-owner /tmp/Tarabari.dump
   ```
   فایل‌های آپلودی و پوشه‌های `cdn` را با `rsync` به `data/` بفرستید. نشست ایتا (volume `goomni-data`) را هم با `docker run --rm -v goomni-data:/d alpine tar c -C /d .` منتقل کنید.
8. **اجرا:** از سیستم توسعه `./ship.sh deploy@server`. بعد روی سرور:
   ```bash
   docker compose exec ollama ollama pull bge-m3
   ```

## بررسی VPN روی سرور

```bash
docker compose logs gluetun | tail -30     # «connected» و «healthy»
docker compose exec transport node -e "fetch('https://api.telegram.org').then(r=>console.log('direct',r.status),()=>console.log('direct blocked'))"
docker compose exec transport sh -c 'node -e "const {HttpsProxyAgent}=require(\"https-proxy-agent\");require(\"https\").get(\"https://api.telegram.org\",{agent:new HttpsProxyAgent(process.env.OUTBOUND_PROXY_URL)},r=>console.log(\"via VPN\",r.statusCode)).on(\"error\",e=>console.log(\"via VPN error\",e.message))"'
```

خط اول باید «blocked» بدهد و خط دوم یک کد HTTP. اگر gluetun گفت Endpoint باید IP باشد، در `wg0.conf` به‌جای نام سرور VPN، IP آن را بگذارید.

## مهم: یک حساب، یک دستگاه

سیستم توسعه و سرور **نباید هم‌زمان** با یک ربات تلگرام، بله، روبیکا، شماره‌ی واتساپ یا حساب ایتا کار کنند. دو نسخه همدیگر را قطع می‌کنند و واتساپ ممکن است بن شود. سیستم توسعه یا حساب‌های تستی جدا دارد، یا پیام‌رسان‌هایش خاموش است.

## پشتیبان‌گیری

- **زمان و جا:** هر شب ساعت `BACKUP_AT` (پیش‌فرض ۳:۳۰) سرویس `backup` از Transport، Tarabari و نشست ایتا در `BACKUP_DIR/<تاریخ>/` پشتیبان می‌گیرد. اگر دستگاه دیسک دیگری دارد، `BACKUP_DIR` را روی آن بگذارید.
- **بررسی:** هر فایل بلافاصله بررسی می‌شود که قابل بازگرداندن باشد.
- **نگهداری:** `BACKUP_KEEP_DAYS` روز آخر (پیش‌فرض ۱۴) نگه داشته می‌شود.
- **هشدار:** اگر ۲۶ ساعت پشتیبان موفقی گرفته نشود، `docker compose ps` سرویس `backup` را `unhealthy` نشان می‌دهد.

```bash
docker compose exec backup /backup.sh now      # یک پشتیبان همین الان
docker compose logs backup                     # نتیجه‌ی پشتیبان‌ها
./pull-backups.sh user@server                  # روی سیستم توسعه: کپی پشتیبان‌های سرور (فقط تازه‌ها) در ../../backups/server
```

پشتیبانی که فقط روی همان سرور باشد با خراب شدن سرور از دست می‌رود. `pull-backups.sh` را مرتب اجرا کنید، مثلاً روزانه با cron روی سیستم توسعه.

### بازگرداندن

```bash
docker compose stop transport tarabari
docker compose exec postgres dropdb -U postgres Transport && docker compose exec postgres createdb -U postgres Transport
docker compose cp data/backups/<تاریخ>/Transport.dump postgres:/tmp/
docker compose exec postgres pg_restore -U postgres -d Transport --no-owner /tmp/Transport.dump
# Tarabari همین‌طور؛ نشست ایتا:
docker compose stop goomni && docker run --rm -v goomni-data:/d -v "$PWD/data/backups/<تاریخ>":/b alpine sh -c 'rm -rf /d/* && tar -xzf /b/goomni-data.tgz -C /d'
docker compose up -d
```

## کارهای روزمره

```bash
docker compose ps                    # وضعیت
docker compose logs -f transport     # لاگ
docker compose restart transport     # ری‌استارت یک سرویس
```

## روی سرور نیست

- مدل‌های سنگین Ollama (خواندن رسید، جایگزین محلی OpenAI): رسیدها دستی بررسی می‌شوند و جواب‌ها فقط از OpenAI می‌آیند. بعداً vLLM روی سرور GPU جای این‌ها را می‌گیرد.
- whisper.cpp و Piper: صدا به متن با OpenAI انجام می‌شود.
