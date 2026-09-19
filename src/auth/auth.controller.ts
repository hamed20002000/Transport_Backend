import { Controller, Post, Body, HttpException, HttpStatus, Get, UseGuards, Req, Put, Query, Session, Res, Param, Redirect } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from 'src/dto/auth/login-dto';
import {  ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserService } from 'src/services/UserService';

import { PasswordService } from 'src/services/auth/password.service';

import { ConfigService } from '@nestjs/config';
import { AppleAuthService, AppleUser } from 'src/application/services/helper/apple-atuh.service';
import { ImageService } from 'src/application/services/helper/image.service';
import { RecordStatus } from 'src/domain/enums/RecordStatus';


@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService, private userService: UserService, private passwordService: PasswordService,
    private readonly configService: ConfigService,
    private appleService: AppleAuthService,
    private readonly imageService: ImageService
  ) { }
  @Get('download')
  async downloadImage(@Query('url') imageUrl: string) {
    if (!imageUrl) {
      return { message: 'Image URL is required' };
    }

    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
    const savedPath = await this.imageService.downloadImage(imageUrl, fileName);

    return { message: 'Image saved successfully', path: savedPath };
  }
  @Post('login')
  @ApiOperation({ summary: 'get token' })  // Operation description
  @ApiResponse({ status: 400, description: 'Bad request' })  // Error response
  @ApiResponse({ status: 200, description: 'Successfull login', type: String })
  async login(@Body() user: LoginDto) {


    var result = await this.authService.login(user);
    if (!result.isAuthenticate) {
      throw new HttpException(
        result.message ?? 'Authentication failed',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return result.accessToken;
  }








}
