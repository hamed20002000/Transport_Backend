# Setas Backend

Backend پروژه Setas با **NestJS**، **TypeScript**، **PostgreSQL** و **TypeORM**.

این سرویس شامل ماژول‌های مختلفی مثل احراز هویت، مدیریت کاربران، انبار، منابع انسانی، آموزش، گزارش‌ها، نوتیفیکیشن و بخش Agent است.

## پیش‌نیازها

- Node.js 20 یا بالاتر
- npm 10 یا بالاتر
- PostgreSQL 14 یا بالاتر

## نصب

```bash
npm install
```

## تنظیمات محیطی

فایل `.env` باید در ریشه پروژه وجود داشته باشد. پروژه از `ConfigModule` برای خواندن تنظیمات استفاده می‌کند.

نمونه متغیرهای مهم:

```env
NODE_ENV=development
PORT=3001

DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=Setas
DB_SYNCHRONIZE=false

JWT_SECRET_KEY=your_jwt_secret
JWT_EXPIRATION_TIME=64800s

CORS_ORIGIN=http://localhost:3000,http://localhost:5173
CORS_METHODS=GET,HEAD,PUT,PATCH,POST,DELETE
CORS_CREDENTIALS=true

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
API_MAIN_URL=http://localhost:3001/
```

نکته:

- مقدارهای واقعی را با اطلاعات محیط خودتان جایگزین کنید.
- `CORS_ORIGIN` می‌تواند چند دامنه با کاما جدا شود.
- این پروژه به PostgreSQL متصل می‌شود و با `synchronize=false` طراحی شده است، پس برای محیط واقعی بهتر است migrationها را مدیریت کنید.

## اجرای پروژه

### حالت توسعه

```bash
npm run start:dev
```

### حالت عادی

```bash
npm run start
```

### اجرای نسخه production

ابتدا build بگیرید:

```bash
npm run build
```

سپس اجرا کنید:

```bash
npm run start:prod
```

## Build

```bash
npm run build
```

این دستور پروژه NestJS را build می‌کند و سپس فایل‌های `.env` و `package.json` را به پوشه `dist` کپی می‌کند.

## Swagger

بعد از اجرای پروژه، مستندات API از این مسیر در دسترس است:

```text
/api-docs
```

این بخش با Basic Auth محافظت شده است.

- Username: `admin`
- Password: `123qwe$%`

اگر خواستید در محیط خودتان امن‌ترش کنید، این مقدارها را در کد `src/main.ts` تغییر دهید.

## Database

پروژه از TypeORM و PostgreSQL استفاده می‌کند.

### اجرای migration

دستورات TypeORM در `package.json` تعریف شده‌اند:

```bash
npm run typeorm migration:run
```

برای ساخت migration جدید:

```bash
npm run typeorm migration:generate -- -n migration_name
```

## Seed

اسکریپت seed در `package.json` وجود دارد:

```bash
npm run seed
```

اما فایل seed فعلی در وضعیت فعلی پروژه کامنت شده است. اگر قصد استفاده از seed را دارید، باید محتوای فایل
`src/infrastructure/database/seeds/seed.ts`
را فعال یا کامل کنید.

## اسکریپت‌های مفید

```bash
npm run format
npm run lint
npm run test
npm run test:cov
npm run test:e2e
```

## مسیرهای استاتیک

برنامه دو مسیر استاتیک را سرو می‌کند:

- `/uploads`
- `/cdn`

فایل‌های مربوطه از پوشه‌های `uploads` و `cdn` در خروجی برنامه خوانده می‌شوند.

## قابلیت‌ها

- احراز هویت با JWT
- ورود گوگل
- Swagger API Docs
- محدودسازی درخواست‌ها با Throttler
- WebSocket با `socket.io`
- بارگذاری فایل
- سرو فایل‌های استاتیک
- ماژول Agent و ابزارهای مرتبط

## مدل‌های استفاده‌شده در Agent

این پروژه برای بخش Agent به مدل‌های محلی Ollama و Whisper استفاده می‌کند:

- `qwen3:8b` برای chat / function calling / تصمیم‌گیری بین SQL و tool calling
- `bge-m3:latest` برای embedding و vectorization
- `ggml-medium.bin` برای speech-to-text در `whisper.cpp`

تنظیمات مربوط به Ollama در کد به‌صورت پیش‌فرض به این آدرس اشاره می‌کنند:

```text
http://localhost:11434/api/chat
```

اگر این مدل‌ها را روی سیستم خودتان دارید با نام متفاوت اجرا می‌کنید، باید مقدارهای مربوطه را در کد یا متغیرهای محیطی هماهنگ کنید.

## ساختار کلی

- `src/main.ts`: نقطه شروع برنامه
- `src/app.module.ts`: ماژول اصلی و تنظیمات دیتابیس
- `src/auth`: منطق احراز هویت
- `src/application/services`: سرویس‌های دامنه‌ای
- `src/domain`: entityها، migrationها و تنظیمات دیتابیس
- `src/infrastructure`: لایه زیرساخت و seedها
- `src/presentation`: کنترلرها

## نکات مهم

- مقدارهای واقعی `.env` را در ریپازیتوری commit نکنید.
- اگر پورت یا آدرس API تغییر کرد، `PORT` و `API_MAIN_URL` را هماهنگ کنید.
- برای محیط production، تنظیمات CORS و secretها را حتماً بازبینی کنید.

## لایسنس

این پروژه private است و لایسنس عمومی برای آن تعریف نشده است.
