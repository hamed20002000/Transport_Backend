import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Transform, Type } from 'class-transformer';
import { memoryStorage } from 'multer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CompanyFeatureGuard, RequireCompanyFeature } from 'src/auth/guards/companyFeature.guard';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { DRIVER_INVITE_PREFIX } from 'src/services/messengerBot/core/factoryInvite';
import { DriverInviteService, MAX_DRIVER_INVITES } from 'src/services/company/driverInvite.service';
import { driverExcelTemplate, MAX_DRIVER_EXCEL_BYTES, readDriverExcel } from 'src/services/company/driverInviteExcel';
import { isCompanyRole } from 'src/services/company/companyFeature.service';
import { messengerInvites } from 'src/services/company/inviteLinks';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

export class DriverInviteItemDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MaxLength(20)
  mobile!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MaxLength(200)
  name?: string;
}

/** One driver or a batch (each number on its own: a refused one does not stop the others). */
export class CreateDriverInvitesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_DRIVER_INVITES)
  @ValidateNested({ each: true })
  @Type(() => DriverInviteItemDto)
  drivers!: DriverInviteItemDto[];
}

const excelUploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_DRIVER_EXCEL_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) =>
    /\.(xlsx|xls)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new BadRequestException('فقط فایل اکسل (xlsx یا xls) قابل بارگذاری است.'), false),
};

function companyUserId(request: AuthRequest): string {
  if (!request.user?.userId || !isCompanyRole(request.user.roles)) throw new ForbiddenException('onlyCompany');
  return request.user.userId;
}

/**
 * شرکت حمل‌ونقل: دعوت شخصی راننده‌ها با شماره‌شان (تکی یا چندتایی) با لینک وب (/driver-invite/…) و کد پیام‌رسان‌های
 * (drv_…) هر کدام؛ فهرست را می‌شود از اکسل هم خواند. جزو بخش پولی «رانندگان».
 */
@Controller('api/company/driver-invites')
@UseGuards(JwtAuthGuard, CompanyFeatureGuard)
@RequireCompanyFeature(CompanyFeature.Drivers)
export class CompanyDriverInviteController {
  constructor(
    private readonly invites: DriverInviteService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@Req() request: AuthRequest) {
    const rows = await this.invites.list(companyUserId(request));
    return rows.map((row) => ({ ...row, messengers: this.messengers(row.token) }));
  }

  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateDriverInvitesDto) {
    const { outcomes, sms } = await this.invites.invite(companyUserId(request), dto.drivers);
    return {
      outcomes: outcomes.map((outcome) => (outcome.status === 'refused' ? outcome : { ...outcome, messengers: this.messengers(outcome.token) })),
      sms,
    };
  }

  @Get('excel/template')
  excelTemplate(@Req() request: AuthRequest) {
    companyUserId(request);
    return new StreamableFile(driverExcelTemplate(), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="drivers-template.xlsx"',
    });
  }

  /** Only reads the file: the drivers go into the form, where the company checks them and sends the invite. */
  @Post('excel')
  @UseInterceptors(FileInterceptor('file', excelUploadOptions))
  readExcel(@Req() request: AuthRequest, @UploadedFile() file?: Express.Multer.File) {
    companyUserId(request);
    if (!file) throw new BadRequestException('فایل اکسل را انتخاب کنید.');
    return readDriverExcel(file.buffer);
  }

  @Delete(':driverUserId')
  remove(@Req() request: AuthRequest, @Param('driverUserId', ParseUUIDPipe) driverUserId: string) {
    return this.invites.remove(companyUserId(request), driverUserId);
  }

  private messengers(token: string) {
    return messengerInvites(this.config, `${DRIVER_INVITE_PREFIX}${token}`);
  }
}

/** صفحه‌ی لینک دعوت راننده: پیش از ورود شرکت و شماره‌ی دعوت‌شده (پوشیده)؛ بعد از ورود، همان شماره است؟ */
@Controller('api/driver-invites')
export class DriverInviteInfoController {
  constructor(private readonly invites: DriverInviteService, private readonly config: ConfigService) {}

  // the sign-in page the link opens also offers the messengers, with this invite's code
  @Get(':token')
  async info(@Param('token') token: string) {
    const info = await this.invites.info(token);
    return { ...info, messengers: info.valid ? messengerInvites(this.config, `${DRIVER_INVITE_PREFIX}${token}`) : null };
  }

  @Get(':token/membership')
  @UseGuards(JwtAuthGuard)
  async membership(@Req() request: AuthRequest, @Param('token') token: string) {
    return { member: !!request.user?.userId && (await this.invites.isInvited(request.user.userId, token)) };
  }
}
