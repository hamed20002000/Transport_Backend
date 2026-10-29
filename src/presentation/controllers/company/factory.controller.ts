import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { memoryStorage } from 'multer';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CompanyFeatureGuard, RequireCompanyFeature } from 'src/auth/guards/companyFeature.guard';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { PublishCargoListingDto } from 'src/dto/notification/PublishCargoListingDto';
import { FACTORY_ROLE, FactoryService } from 'src/services/company/factory.service';
import { isCompanyRole } from 'src/services/company/companyFeature.service';
import { CargoExcelService, MAX_EXCEL_BYTES } from 'src/services/notification/cargoExcel.service';
import { INVITE_CODE_PREFIX } from 'src/services/messengerBot/core/factoryInvite';
import { messengerInvites } from 'src/services/company/inviteLinks';

type AuthRequest = { user?: { userId?: string; roles?: string[] } };

/** بار کارخانه: همان فیلدهای «ثبت بار» شرکت به‌همراه شرکتی که بار برایش فرستاده می‌شود. */
export class FactoryCargoDto extends PublishCargoListingDto {
  @IsUUID()
  companyUserId!: string;
}

const excelUploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_EXCEL_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) =>
    /\.(xlsx|xls)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new BadRequestException('فقط فایل اکسل (xlsx یا xls) قابل بارگذاری است.'), false),
};

function companyUserId(request: AuthRequest): string {
  if (!request.user?.userId || !isCompanyRole(request.user.roles)) throw new ForbiddenException('onlyCompany');
  return request.user.userId;
}

function factoryUserId(request: AuthRequest): string {
  if (!request.user?.userId || !request.user.roles?.includes(FACTORY_ROLE)) throw new ForbiddenException('onlyFactory');
  return request.user.userId;
}

export class CreateFactoryInviteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MaxLength(20)
  mobile!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString() @MaxLength(200)
  factoryName?: string;
}

/**
 * شرکت حمل‌ونقل: دعوت شخصی کارخانه‌ها با شماره‌شان (حساب همان لحظه ساخته می‌شود و کارخانه عضو لیست شرکت است) و
 * فهرست کارخانه‌ها با لینک وب (/invite/…) و کد پیام‌رسان‌های (inv_…) هر کدام.
 */
@Controller('api/company/factories')
@UseGuards(JwtAuthGuard, CompanyFeatureGuard)
// a paid menu: a non-parent company that has not bought it gets 402 COMPANY_FEATURE_REQUIRED
@RequireCompanyFeature(CompanyFeature.Factories)
export class CompanyFactoryController {
  constructor(
    private readonly factories: FactoryService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@Req() request: AuthRequest) {
    const factories = await this.factories.factoriesOf(companyUserId(request));
    return factories.map((factory) => ({ ...factory, messengers: factory.token ? this.messengers(factory.token) : null }));
  }

  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateFactoryInviteDto) {
    const invite = await this.factories.createInvite(companyUserId(request), dto.mobile, dto.factoryName);
    return { ...invite, messengers: this.messengers(invite.token) };
  }

  private messengers(token: string) {
    return messengerInvites(this.config, `${INVITE_CODE_PREFIX}${token}`);
  }

  @Delete(':factoryUserId')
  remove(@Req() request: AuthRequest, @Param('factoryUserId', ParseUUIDPipe) factoryUserId: string) {
    return this.factories.removeFactory(companyUserId(request), factoryUserId);
  }
}

/** صفحه‌ی لینک دعوت پیش از ورود: شرکت دعوت‌کننده و شماره‌ی دعوت‌شده (پوشیده). */
@Controller('api/factory-invites')
export class FactoryInviteController {
  constructor(private readonly factories: FactoryService, private readonly config: ConfigService) {}

  // the sign-in page the link opens also offers the messengers, with this invite's code
  @Get(':token')
  async info(@Param('token') token: string) {
    const info = await this.factories.inviteInfo(token);
    return { ...info, messengers: info.valid ? messengerInvites(this.config, `${INVITE_CODE_PREFIX}${token}`) : null };
  }
}

/** پنل کارخانه: فقط ثبت بار (تکی یا اکسل) برای یکی از شرکت‌هایی که دعوتش کرده‌اند. */
@Controller('api/factory')
@UseGuards(JwtAuthGuard)
export class FactoryController {
  constructor(
    private readonly factories: FactoryService,
    private readonly excel: CargoExcelService,
  ) {}

  /** صفحه‌ی لینک برای کاربری که وارد شده: همان شماره‌ی کارخانه‌ی دعوت‌شده است؟ */
  @Get('invites/:token/membership')
  async membership(@Req() request: AuthRequest, @Param('token') token: string) {
    return { member: !!request.user?.userId && (await this.factories.isInvited(request.user.userId, token)) };
  }

  @Get('companies')
  companies(@Req() request: AuthRequest) {
    return this.factories.companies(factoryUserId(request));
  }

  // نام و شماره‌های کارخانه برای فرم ثبت بار
  @Get('draft')
  draft(@Req() request: AuthRequest) {
    return this.factories.draft(factoryUserId(request));
  }

  @Get('loads')
  loads(
    @Req() request: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.factories.myLoads(factoryUserId(request), Math.max(page, 1), Math.min(Math.max(pageSize, 1), 100));
  }

  @Post('loads')
  send(@Req() request: AuthRequest, @Body() dto: FactoryCargoDto) {
    // companyName is the transport company's, given when it announces the load; a factory does not send one
    const { companyUserId: company, origin, destination, cargoType, weight, vehicleType, price, extraNotes, contactPhones, photo } = dto;
    return this.factories.send(factoryUserId(request), company, { origin, destination, cargoType, weight, vehicleType, price, extraNotes, contactPhones, photo });
  }

  // همان فایل نمونه‌ی «ثبت بار» شرکت
  @Get('loads/excel/template')
  excelTemplate(@Req() request: AuthRequest) {
    factoryUserId(request);
    return new StreamableFile(this.excel.template(), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="cargo-template.xlsx"',
    });
  }

  /** dryRun=true فقط بررسی و پیش‌نمایش؛ اگر ردیفی ایراد داشت هیچ باری فرستاده نمی‌شود. */
  @Post('loads/excel')
  @UseInterceptors(FileInterceptor('file', excelUploadOptions))
  importExcel(
    @Req() request: AuthRequest,
    @Query('companyUserId', ParseUUIDPipe) company: string,
    @Query('dryRun', new DefaultValuePipe(false), ParseBoolPipe) dryRun: boolean,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = factoryUserId(request);
    if (!file) throw new BadRequestException('file is required.');
    return this.factories.importExcel(userId, company, file.buffer, dryRun);
  }
}
