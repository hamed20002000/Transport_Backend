import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
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
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

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
    .setTitle('Setas APIs')  // Title of your API
    .setDescription('API documentation for Setas')  // Description of your API
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
 

  await app.listen(process.env.PORT ?? 3333);
}
bootstrap();
//npm run typeorm migration:generate -n user_banner_image
//npm run typeorm migration:run  