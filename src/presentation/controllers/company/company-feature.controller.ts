import { randomUUID } from 'crypto';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { IsUUID } from 'class-validator';
import { diskStorage } from 'multer';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CompanyFeatureService, isCompanyRole } from 'src/services/company/companyFeature.service';
import { receiptDir } from 'src/services/subscription/receiptStorage';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

const RECEIPT_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

export const receiptUploadOptions: MulterOptions = {
  storage: diskStorage({
    // the private receipt store, beside the subscription receipts from the app
    destination: (_req, _file, cb) => cb(null, receiptDir('web')),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}.${RECEIPT_EXTENSIONS[file.mimetype]}`),
  }),
  fileFilter: (_req, file, cb) => {
    if (!RECEIPT_EXTENSIONS[file.mimetype]) return cb(new BadRequestException('عکس رسید باید JPG، PNG یا WebP باشد.'), false);
    cb(null, true);
  },
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
};

export class CreateFeatureOrderDto {
  @IsUUID()
  planId!: string;
}

function companyUserId(request: AuthRequest): string {
  if (!request.user?.userId || !isCompanyRole(request.user.roles)) throw new ForbiddenException('onlyCompany');
  return request.user.userId;
}

/**
 * خرید منوها (CompanyFeature) برای شرکت غیرمادر: همان کارت‌به‌کارت و فیش اشتراک، در صف بررسی
 * admin/company-features/orders. بدون CompanyFeatureGuard، چون خرید همیشه باید ممکن باشد.
 */
@Controller('api/company/features')
@UseGuards(JwtAuthGuard)
export class CompanyFeatureController {
  constructor(
    private readonly features: CompanyFeatureService,
    private readonly config: ConfigService,
  ) {}

  /** مادر بودن، وضعیت و پلن‌های هر منو، کارت پرداخت و آخرین خریدها. */
  @Get()
  async status(@Req() request: AuthRequest) {
    const status = await this.features.status(companyUserId(request));
    return {
      ...status,
      payment: {
        cardNumber: this.config.get<string>('CARD_NO', ''),
        cardOwner: this.config.get<string>('CARD_OWNER', ''),
      },
    };
  }

  /** انتخاب پلن و فرستادن فیش در یک درخواست (multipart: planId + file). */
  @Post('orders')
  @UseInterceptors(FileInterceptor('file', receiptUploadOptions))
  async order(@Req() request: AuthRequest, @Body() dto: CreateFeatureOrderDto, @UploadedFile() file: Express.Multer.File | undefined) {
    const userId = companyUserId(request);
    if (!file) throw new BadRequestException('عکس رسید پرداخت را انتخاب کنید.');
    await this.features.submitOrder(userId, dto.planId, file.path);
    return this.status(request);
  }
}
