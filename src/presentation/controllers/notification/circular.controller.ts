import { createReadStream } from 'node:fs';

import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CircularService, circularUploadOptions } from 'src/services/circular/circular.service';
import { requireAdmin } from '../admin/subscription-policy.controller';

type AuthRequest = { user?: { userId?: string; roles?: string[]; isActive?: boolean } };

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCircularDto {
  @Transform(trim)
  @IsString() @MinLength(3, { message: 'عنوان بخشنامه را بنویسید.' }) @MaxLength(200)
  title!: string;

  @IsOptional() @Transform(trim)
  @IsString() @MaxLength(5000)
  body?: string;
}

/** The file of a circular, opened in the browser (a PDF or a picture) under its own name. */
async function streamFile(circulars: CircularService, id: string): Promise<StreamableFile> {
  const file = await circulars.file(id);
  return new StreamableFile(createReadStream(file.path), {
    type: file.mimeType,
    disposition: `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  });
}

/** ادمین: بارگذاری بخشنامه برای راننده‌ها (خبرش همان لحظه به همه‌ی راننده‌ها می‌رسد)، فهرست و حذف. */
@Controller('api/admin/circulars')
@UseGuards(JwtAuthGuard)
export class AdminCircularController {
  constructor(private readonly circulars: CircularService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    requireAdmin(request);
    return this.circulars.adminList();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', circularUploadOptions))
  create(@Req() request: AuthRequest, @Body() dto: CreateCircularDto, @UploadedFile() file?: Express.Multer.File) {
    const adminUserId = requireAdmin(request)!;
    return this.circulars.create(adminUserId, dto.title, dto.body ?? null, file);
  }

  @Delete(':id')
  remove(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    requireAdmin(request);
    return this.circulars.remove(id);
  }

  @Get(':id/file')
  file(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    requireAdmin(request);
    return streamFile(this.circulars, id);
  }
}

/** راننده: بخشنامه‌ها و فایل هر کدام. */
@Controller('api/driver/circulars')
@UseGuards(JwtAuthGuard)
export class DriverCircularController {
  constructor(private readonly circulars: CircularService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    this.driverOnly(request);
    return this.circulars.list();
  }

  @Get(':id/file')
  file(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    this.driverOnly(request);
    return streamFile(this.circulars, id);
  }

  private driverOnly(request: AuthRequest): void {
    if (!request.user?.userId || !request.user.roles?.includes('DRIVER')) throw new ForbiddenException('onlyDriver');
  }
}
