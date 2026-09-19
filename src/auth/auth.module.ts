// src/auth/auth.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { JwtStrategy } from './strategy/jwt.strategy';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GoogleStrategy } from './strategy/google.strategy';
import { UserService } from 'src/services/UserService';
import { EmailService } from 'src/application/services/helper/email-service';
import { AppleAuthService } from 'src/application/services/helper/apple-atuh.service';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ImageService } from 'src/application/services/helper/image.service';

import { UserModule } from 'src/application/module/UserModule';

@Module({
  imports: [
    HttpModule,
    UserModule,
    // Register ConfigModule to read environment variables
    ConfigModule.forRoot({
      isGlobal: true,  // Makes the config available globally in the app
    }),

    PassportModule.register({ defaultStrategy: 'jwt' }),

    JwtModule.registerAsync({
      imports: [ConfigModule],  // Import ConfigModule to access environment variables
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET_KEY','ad;,pwqdpoqwkdopkwqopdqwpdkqwd65165dw1q5d1wqd;wq,dqwdASDwqd'),  // Retrieve the secret from environment variables
        signOptions: { expiresIn: configService.get<string>('JWT_EXPIRATION_TIME','64800s') },  // Retrieve expiration time from environment variables
      }),
      inject: [ConfigService],  // Inject ConfigService
    }),

    
  ],
  providers: [AuthService,ImageService, JwtStrategy,GoogleStrategy,UserService,EmailService,AppleAuthService],  // No need to manually inject UserRepository anymore
  controllers: [AuthController],
  exports: [AuthService,AppleAuthService],
})
export class AuthModule {}
