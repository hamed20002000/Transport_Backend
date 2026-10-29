import { Body, Controller, ForbiddenException, Get, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AccountVerificationService } from 'src/services/company/accountVerification.service';
import { BrokerAccessService } from 'src/services/company/brokerAccess.service';
import { BROKER_ROLE } from 'src/services/notification/loadRequesters';
import { receiptUploadOptions } from './company-feature.controller';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

export class CreateBrokerAccessOrderDto {
  @IsIn(['NEW', 'ADD'])
  kind!: 'NEW' | 'ADD';

  // multipart sends a list as «a,b,c» (or repeated fields); JSON as an array
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((part) => part.trim()).filter(Boolean) : value))
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true })
  companyUserIds!: string[];
}

function brokerUserId(request: AuthRequest): string {
  if (!request.user?.userId || !request.user.roles?.includes(BROKER_ROLE)) throw new ForbiddenException('onlyBroker');
  return request.user.userId;
}

/**
 * خرید دسترسی واسط به بار شرکت‌ها: انتخاب شرکت‌ها، کارت‌به‌کارت و فیش، در صف بررسی admin/broker-access/orders.
 * بدون بررسی اعتبار حساب، چون دیدن قیمت و خرید همیشه باید ممکن باشد.
 */
@Controller('api/broker/access')
@UseGuards(JwtAuthGuard)
export class BrokerAccessController {
  constructor(
    private readonly access: BrokerAccessService,
    private readonly verification: AccountVerificationService,
    private readonly config: ConfigService,
  ) {}

  /** قیمت‌ها، دوره‌ی باز، شرکت‌های قابل انتخاب، کارت پرداخت، آخرین خریدها و باز بودن دستیار. */
  @Get()
  async status(@Req() request: AuthRequest) {
    const userId = brokerUserId(request);
    const [status, approved, open] = await Promise.all([this.access.status(userId), this.verification.isApproved(userId), this.access.hasOpenAccess(userId)]);
    return {
      ...status,
      // the assistant: after the parent company's approval, and while brokers pay, with companies bought
      agent: approved && open,
      payment: {
        cardNumber: this.config.get<string>('CARD_NO', ''),
        cardOwner: this.config.get<string>('CARD_OWNER', ''),
      },
    };
  }

  /** دوره‌ی تازه (NEW) یا افزودن شرکت به دوره‌ی باز (ADD) با فیش در یک درخواست (multipart: kind + companyUserIds + file). */
  @Post('orders')
  @UseInterceptors(FileInterceptor('file', receiptUploadOptions))
  async order(@Req() request: AuthRequest, @Body() dto: CreateBrokerAccessOrderDto, @UploadedFile() file: Express.Multer.File | undefined) {
    const userId = brokerUserId(request);
    const result = await this.access.submitOrder(userId, dto, file?.path ?? null);
    return { ...(await this.status(request)), added: result.added };
  }
}
