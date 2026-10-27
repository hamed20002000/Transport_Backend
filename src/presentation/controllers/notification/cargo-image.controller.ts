import { BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CargoImageFields, CargoImageService, CargoImageSize, MAX_CARGO_PHOTO_BYTES } from 'src/services/notification/cargoImage.service';
import { CargoListingRepository } from 'src/infrastructure/repositories/notification/cargoListing.repository';
import { CargoNotificationRepository } from 'src/infrastructure/repositories/notification/cargoNotification.repository';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// who puts loads on the system with a photo
const PUBLISHER_ROLES = ['COMPANY', 'COMPANY_ADMIN', 'FACTORY'];

const photoUpload = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_CARGO_PHOTO_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) =>
    PHOTO_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new BadRequestException('فقط عکس JPG، PNG یا WebP.'), false),
};

/**
 * عکس بار برای نمایش تصویری: آپلود عکس پیش از ثبت بار (اسمش با بار فرستاده می‌شود)، و تصویر هر بار یا پیشنهاد
 * (عکس خودش یا عکس نوع بار). تصویرها بی‌ورود‌اند تا <img> و پیام‌رسان‌ها مستقیم بگیرندشان؛ مشخصات بار در
 * تصویر نیست.
 */
@Controller('api')
export class CargoImageController {
  constructor(
    private readonly images: CargoImageService,
    private readonly listings: CargoListingRepository,
    private readonly notifications: CargoNotificationRepository,
  ) {}

  @Post('cargo-photos')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', photoUpload))
  async upload(@Req() request: AuthRequest, @UploadedFile() file?: Express.Multer.File) {
    if (!request.user?.roles?.some((role) => PUBLISHER_ROLES.includes(role))) throw new ForbiddenException();
    if (!file) throw new BadRequestException('عکس را انتخاب کنید.');
    return { photo: await this.images.store(file.buffer) };
  }

  @Get('cargo-images/listing/:id')
  async listing(@Param('id', ParseUUIDPipe) id: string, @Query('size') size: string | undefined, @Res() response: Response) {
    const listing = await this.listings.findById(id);
    if (!listing) throw new NotFoundException();
    return this.send(response, listing, size);
  }

  @Get('cargo-images/suggestion/:id')
  async suggestion(@Param('id', ParseUUIDPipe) id: string, @Query('size') size: string | undefined, @Res() response: Response) {
    const suggestion = await this.notifications.findSuggestionById(id);
    if (!suggestion) throw new NotFoundException();
    return this.send(response, suggestion.payload as CargoImageFields, size);
  }

  // ?size=thumb: the small picture of the web cards; otherwise the messengers' size
  private async send(response: Response, fields: CargoImageFields, size?: string) {
    const jpeg = await this.images.image(fields, size === 'thumb' ? 'thumb' : 'message');
    response.setHeader('Content-Type', 'image/jpeg');
    // a load's photo does not change; a day in any cache
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.end(jpeg);
  }
}
