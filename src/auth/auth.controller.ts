import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from 'src/dto/auth/login-dto';
import { RegisterDto } from 'src/dto/auth/register-dto';
import { RegistrationService } from 'src/services/auth/registration.service';
import { VerifyRegistrationDto, RefreshTokenDto } from 'src/dto/auth/verify-registration-dto';
import { ImageService } from 'src/application/services/helper/image.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly imageService: ImageService,
    private readonly registration: RegistrationService,
  ) {}
  @Get('download')
  async downloadImage(@Query('url') imageUrl: string) {
    if (!imageUrl) {
      return { message: 'Image URL is required' };
    }

    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
    const savedPath = await this.imageService.downloadImage(imageUrl, fileName);

    return { message: 'Image saved successfully', path: savedPath };
  }
  @Post('register/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Send a registration verification code by SMS' })
  async requestOtp(@Body() dto: RegisterDto) {
    return this.registration.requestOtp(dto);
  }

  @Post('register/verify-otp')
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Verify phone number, create account and issue tokens' })
  async verifyOtp(@Body() dto: VerifyRegistrationDto) {
    return this.registration.verifyOtp(dto.phoneNumber, dto.code);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.registration.refresh(dto.refreshToken);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Login with username and password' }) // Operation description
  @ApiResponse({ status: 400, description: 'Bad request' }) // Error response
  @ApiResponse({ status: 200, description: 'Successfull login', type: String })
  @ApiResponse({ status: 401, description: 'Invalid credentials or no active roles' })
  async login(@Body() user: LoginDto) {
    const result = await this.authService.login(user);
    if (!result.isAuthenticate || !result.accessToken) {
      throw new HttpException(result.message ?? 'Authentication failed', HttpStatus.UNAUTHORIZED);
    }
    return result.accessToken;
  }
}
