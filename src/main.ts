import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './middlewares/logger.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { RequestLoggerMiddleware } from './middlewares/log-middlware';

// Basic Authentication Middleware
function basicAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const auth = { login: 'admin', password: '123qwe$%' }; // Change to your username and password

  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login && password && login === auth.login && password === auth.password) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Authentication required.');
}

// کتابخانه‌ی RabbitMQ وقتی اتصال وسط یک درخواست قطع شود، گاهی یک Promise
// ردشده بدون catch رها می‌کند ("Channel ended, no reply will be forthcoming")
// که پیش‌فرض Node کل پروسه را می‌کشد. قطع اتصال خودکار دوباره وصل می‌شود؛ API
// نباید به‌خاطرش پایین بیاید.
process.on('unhandledRejection', (reason: unknown) => {
  new Logger('UnhandledRejection').error(
    reason instanceof Error ? reason.message : String(reason),
    reason instanceof Error ? reason.stack : undefined,
  );
});

async function bootstrap() {
  // rawBody: webhooks signed over the exact bytes (GoOmni for the Eitaa bot) are checked before parsing
  // logs go to files per messenger and app (AppLogger), not the console
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: new AppLogger() });
  const configService = app.get(ConfigService);

  // Payment receipts once lived in the public uploads folder; they are private now (receiptStorage) and that
  // old address must never serve a file, even before `npm run move:receipts` has moved them. Registered before
  // the static files, which are added when the app starts.
  // Users' voices kept for training the Persian speech model (STT_SAMPLE_DIR) once lay in that public folder too.
  for (const path of ['/uploads/payment-receipts', '/uploads/stt-dataset']) {
    app.use(path, (_request: unknown, response: { status: (code: number) => { end: () => void } }) => response.status(404).end());
  }

  // Enable CORS using environment variables
  app.enableCors({
    origin: configService
      .get<string>('CORS_ORIGIN', 'Z2LUGTa3UmZZ26TLaXAEYgx5KW8J2bPRhttps://localhost:5173,http://152.89.36.254:8080,https://matesbridge.com,https://www.matesbridge.com')
      .split(','),
    methods: configService.get<string>('CORS_METHODS', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS'),
    credentials: configService.get<boolean>('CORS_CREDENTIALS', true),
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  

  // Configure Swagger
  const config = new DocumentBuilder()
    .setTitle('Trabot APIs')  // Title of your API
    .setDescription('API documentation for Trabot')  // Description of your API
    .setVersion('1.0.0')  // Version of the API
    .addBearerAuth() 
    /* .setBasePath('/api')  */  
    .build();

  // Apply the basic authentication middleware to the Swagger route
  app.use('/api-docs', basicAuthMiddleware);
 /*  app.use(new RequestLoggerMiddleware().use); */
  // Create the Swagger document and set it up at '/api-docs'
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  // Apply global pipes, interceptors, and filters
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // On SIGTERM/SIGINT (e.g. a --watch restart) onModuleDestroy runs, so the
  // WhatsApp socket closes and its session is saved before the process exits.
  app.enableShutdownHooks();

  await listenWithRetry(app, process.env.PORT ?? 3333);
}

// با --watch پروسه‌ی قبلی تا چند ثانیه (ذخیره‌ی نشست واتساپ) پورت را نگه می‌دارد؛
// بدون تلاش دوباره listen با EADDRINUSE شکست می‌خورد و API بالا نمی‌آمد.
async function listenWithRetry(app: Awaited<ReturnType<typeof NestFactory.create>>, port: number | string, attempts = 15) {
  for (let attempt = 1; ; attempt++) {
    try {
      await app.listen(port);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE' || attempt >= attempts) throw error;
      new Logger('Bootstrap').warn(`Port ${port} is still in use; retrying (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// handler بالا خطاها را فقط لاگ می‌کند؛ اگر راه‌اندازی شکست بخورد پروسه نباید
// نیمه‌جان (ربات‌ها روشن، API خاموش) بماند.
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error('Application failed to start', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
//npm run typeorm migration:generate -n user_banner_image
//npm run typeorm migration:run  