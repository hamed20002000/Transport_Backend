import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompleteRegistrationDto, RequestOtpDto } from 'src/dto/auth/register-dto';
import { RegistrationService } from 'src/services/auth/registration.service';
import { VerifyRegistrationDto, RefreshTokenDto } from 'src/dto/auth/verify-registration-dto';
import { ImageService } from 'src/application/services/helper/image.service';

@Controller('api/auth')
export class AuthController {
  constructor(
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
  // ثبت‌نام و ورود فقط با موبایل و OTP (یک مسیر برای هر دو؛ مدیرها هم). رمز عبوری در سامانه نیست.
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Send a one-time code by SMS (sign-in or sign-up)' })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.registration.requestOtp(dto.phoneNumber);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Verify the code: tokens for an existing account, otherwise a registrationToken' })
  async verifyOtp(@Body() dto: VerifyRegistrationDto) {
    return this.registration.verifyOtp(dto.phoneNumber, dto.code);
  }

  @Post('otp/complete')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Choose driver or company after verifying a new phone number; creates the account' })
  async completeRegistration(@Body() dto: CompleteRegistrationDto) {
    return this.registration.completeRegistration(dto.registrationToken, dto.accountType);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.registration.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Revoke a refresh token (sign out on this device)' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.registration.revoke(dto.refreshToken);
  }
}
