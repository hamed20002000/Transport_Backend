import { createReadStream } from 'node:fs';

import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  ForbiddenException,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CompanyFeatureGuard, RequireCompanyFeature } from 'src/auth/guards/companyFeature.guard';
import { CompanyFeature } from 'src/domain/enums/companyFeature';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { CreateCargoAlertFilterDto, UpdateCargoAlertFilterDto } from 'src/dto/notification/CargoAlertFilterDto';
import { SetCargoStatusDto } from 'src/dto/notification/SetCargoStatusDto';
import { PublishCargoListingDto } from 'src/dto/notification/PublishCargoListingDto';
import { CargoNotificationKind } from 'src/infrastructure/repositories/notification/cargoNotification.repository';
import { LISTING_STAGES, type ListingStage } from 'src/infrastructure/repositories/notification/cargoListing.repository';
import { CargoListingService } from 'src/services/notification/cargoListing.service';
import { CargoListingStatus, CargoTripType } from 'src/domain/enums/notification';
import { CompanyAnnounceService } from 'src/services/notification/companyAnnounce.service';
import { AnnounceSettingsDto } from 'src/dto/notification/AnnounceSettingsDto';
import { CargoAlertFilterService } from 'src/services/notification/cargoAlertFilter.service';
import { CargoNotificationService } from 'src/services/notification/cargoNotification.service';
import { CargoTripService } from 'src/services/notification/cargoTrip.service';
import { DriverProfileService } from 'src/services/driver/driverProfile.service';
import { OfferCargoDto } from 'src/dto/notification/DriverDto';
import { CargoExcelService, MAX_EXCEL_BYTES } from 'src/services/notification/cargoExcel.service';

type AuthRequest = { user?: JwtPayload };

function currentUserId(request: AuthRequest): string {
  const userId = request.user?.userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
}

function companyUserId(request: AuthRequest): string {
  const userId = currentUserId(request);
  if (!request.user?.roles?.some((role) => role === 'COMPANY' || role === 'COMPANY_ADMIN')) throw new ForbiddenException('onlyCompany');
  return userId;
}

// فایل در حافظه می‌ماند (کوچک است و فقط خوانده می‌شود)؛ فقط xlsx و xls
const excelUploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_EXCEL_BYTES, files: 1 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) =>
    /\.(xlsx|xls)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new BadRequestException('فقط فایل اکسل (xlsx یا xls) قابل بارگذاری است.'), false),
};

@Controller('api/cargo-notifications')
@UseGuards(JwtAuthGuard, CompanyFeatureGuard)
export class CargoNotificationController {
  constructor(
    private readonly notifications: CargoNotificationService,
    private readonly listings: CargoListingService,
  ) {}

  // kind=suggestion: پیشنهادهای بار به شرکت، kind=listing: بارهای منتشرشده برای راننده
  @Get()
  @RequireCompanyFeature(CompanyFeature.Suggestions)
  list(
    @Req() request: AuthRequest,
    @Query('unreadOnly', new DefaultValuePipe(false), ParseBoolPipe) unreadOnly: boolean,
    @Query('kind', new ParseEnumPipe(['suggestion', 'listing'], { optional: true })) kind: CargoNotificationKind | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.notifications.list(currentUserId(request), {
      unreadOnly,
      kind,
      page: Math.max(page, 1),
      pageSize: Math.min(Math.max(pageSize, 1), 100),
    });
  }

  @Get('unread-count')
  unreadCount(@Req() request: AuthRequest) {
    return this.notifications.unreadCount(currentUserId(request));
  }

  @Patch('read-all')
  markAllRead(@Req() request: AuthRequest) {
    return this.notifications.markRead(currentUserId(request));
  }

  @Patch(':id/read')
  markRead(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(currentUserId(request), id);
  }

  // نمونه‌ی «فیلد: مقدار» برای انتشار یک پیشنهاد بار؛ شرکت می‌تواند ویرایشش کند.
  @Get(':id/listing-draft')
  @RequireCompanyFeature(CompanyFeature.Suggestions)
  listingDraft(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.buildDraft(currentUserId(request), id);
  }

  // انتشار بار به نام همین شرکت برای راننده‌ها
  @Post(':id/publish')
  @RequireCompanyFeature(CompanyFeature.Suggestions)
  publish(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishCargoListingDto,
  ) {
    return this.listings.publish(currentUserId(request), id, dto);
  }
}

@Controller('api/cargo-listings')
@UseGuards(JwtAuthGuard, CompanyFeatureGuard)
export class CargoListingController {
  constructor(
    private readonly listings: CargoListingService,
    private readonly trips: CargoTripService,
    private readonly profiles: DriverProfileService,
    private readonly excel: CargoExcelService,
    private readonly announce: CompanyAnnounceService,
  ) {}

  // حالت اعلام بار به راننده‌ها: دستی، یا خودکار هر intervalMinutes
  @Get('announce-settings')
  announceSettings(@Req() request: AuthRequest) {
    return this.announce.get(companyUserId(request));
  }

  @Put('announce-settings')
  setAnnounceSettings(@Req() request: AuthRequest, @Body() dto: AnnounceSettingsDto) {
    return this.announce.set(companyUserId(request), dto.mode, dto.intervalMinutes);
  }

  // راننده‌های یک نوع (داخلی/صادراتی/وارداتی) برای صفحه‌ی «رانندگان» شرکت
  @Get('drivers')
  @RequireCompanyFeature(CompanyFeature.Drivers)
  drivers(
    @Req() request: AuthRequest,
    @Query('type', new ParseEnumPipe(CargoTripType)) type: CargoTripType,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('search') search?: string,
  ) {
    companyUserId(request);
    return this.profiles.listByType(type, Math.max(page, 1), Math.min(Math.max(pageSize, 1), 100), search?.trim() || undefined);
  }

  // فایل نمونه‌ی ثبت چند بار با اکسل
  @Get('excel/template')
  @RequireCompanyFeature(CompanyFeature.CreateLoad)
  excelTemplate(@Req() request: AuthRequest) {
    companyUserId(request);
    return new StreamableFile(this.excel.template(), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="cargo-template.xlsx"',
    });
  }

  /**
   * بارگذاری فایل پرشده: اگر ردیفی ایراد داشت هیچ باری ثبت نمی‌شود و errors برمی‌گردد؛
   * وگرنه همه‌ی بارها ثبت و برای راننده‌ها اعلام می‌شوند. dryRun=true فقط بررسی و پیش‌نمایش.
   */
  @Post('excel')
  @RequireCompanyFeature(CompanyFeature.CreateLoad)
  @UseInterceptors(FileInterceptor('file', excelUploadOptions))
  importExcel(
    @Req() request: AuthRequest,
    @Query('dryRun', new DefaultValuePipe(false), ParseBoolPipe) dryRun: boolean,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = companyUserId(request);
    if (!file) throw new BadRequestException('file is required.');
    return this.excel.import(userId, file.buffer, dryRun);
  }

  // «بارهای من که اعلام نشده‌اند» (بالای پیشنهادها): بار ثبت‌شده‌ای که راننده‌ی مناسب نداشت یا در صف اعلام خودکار است
  @Get('unannounced')
  unannounced(@Req() request: AuthRequest) {
    return this.listings.unannounced(companyUserId(request));
  }

  // بارهایی که همین کاربر (شرکت) منتشر کرده است، با راننده‌ای که هر بار به او سپرده شده
  @Get()
  @RequireCompanyFeature(CompanyFeature.PublishedLoads)
  async listMine(
    @Req() request: AuthRequest,
    @Query('status', new ParseEnumPipe(CargoListingStatus, { optional: true })) status: CargoListingStatus | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    // published (open), inTransit (on a driver's trip) or delivered
    @Query('stage', new ParseEnumPipe(LISTING_STAGES, { optional: true })) stage?: ListingStage,
  ) {
    const result = await this.listings.listMine(currentUserId(request), {
      status,
      stage,
      announcedOnly: true,
      page: Math.max(page, 1),
      pageSize: Math.min(Math.max(pageSize, 1), 100),
    });
    const ids = result.items.map((item) => item.id);
    const [assignments, requests] = await Promise.all([this.trips.assignments(ids), this.trips.pendingRequestCounts(ids)]);
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, assignment: assignments.get(item.id) ?? null, pendingRequests: requests.get(item.id) ?? 0 })),
    };
  }

  // «برداشته شد»: راننده‌هایی که برای این بار درخواست داده‌اند و راننده‌ای که منتظر تأیید است
  @Get(':id/candidates')
  @RequireCompanyFeature(CompanyFeature.PublishedLoads)
  candidates(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.candidates(currentUserId(request), id);
  }

  // راننده‌ی دیگری از سامانه با موبایل یا پلاک کامل
  @Get(':id/candidates/search')
  @RequireCompanyFeature(CompanyFeature.PublishedLoads)
  searchDrivers(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Query('q') query = '') {
    return this.trips.searchDrivers(currentUserId(request), id, query.slice(0, 40));
  }

  // سفرهای فعال شرکت (جدیدترین اول) با راننده و آخرین موقعیتش
  @Get('trips')
  @RequireCompanyFeature(CompanyFeature.Trips)
  companyTrips(
    @Req() request: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.trips.companyTripViews(companyUserId(request), Math.max(page, 1), Math.min(Math.max(pageSize, 1), 100));
  }

  // تعداد سفرهای فعالی که چند روز است تحویلشان ثبت نشده (بنر یادآوری پنل)
  @Get('trips/overdue')
  overdueTrips(@Req() request: AuthRequest) {
    return this.trips.overdueTrips(companyUserId(request));
  }

  // درخواست‌های در انتظار رانندگان برای بارهای شرکت، با کارت راننده
  @Get('requests')
  @RequireCompanyFeature(CompanyFeature.DriverRequests)
  companyRequests(
    @Req() request: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.trips.companyRequestViews(companyUserId(request), Math.max(page, 1), Math.min(Math.max(pageSize, 1), 50));
  }

  // تعداد درخواست‌های در انتظار (شمارنده‌ی تب «درخواست‌ها» و زنگ)
  @Get('requests/count')
  async companyRequestCount(@Req() request: AuthRequest) {
    return { count: await this.trips.countCompanyRequests(companyUserId(request)) };
  }

  // قبول یا رد درخواست راننده (409 notPending / taken / reserved)
  @Patch('requests/:id/:decision')
  @RequireCompanyFeature(CompanyFeature.DriverRequests)
  async decideRequest(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision', new ParseEnumPipe(['accept', 'reject'])) decision: 'accept' | 'reject',
  ) {
    const decided = await this.trips.decide(companyUserId(request), id, decision === 'accept');
    return { requestId: decided.id, status: decided.status };
  }

  // شرکت تحویل بار را ثبت می‌کند؛ راننده خبردار می‌شود (409 notActive اگر سفر فعال نیست)
  @Patch('trips/:id/deliver')
  @RequireCompanyFeature(CompanyFeature.Trips)
  async deliverTrip(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    const delivered = await this.trips.deliver(companyUserId(request), id);
    return { requestId: delivered.id, status: delivered.status, deliveredAt: delivered.deliveredAt };
  }

  // «تحویل نشده»: اعلام تحویل راننده رد می‌شود و سفر فعال می‌ماند (409 notReported اگر اعلامی نبود)
  @Patch('trips/:id/reject-delivery')
  @RequireCompanyFeature(CompanyFeature.Trips)
  async rejectDelivery(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    const trip = await this.trips.rejectDeliveryReport(companyUserId(request), id);
    return { requestId: trip.id, status: trip.status, deliveryReportedAt: trip.deliveryReportedAt ?? null };
  }

  // سپردن بار به راننده؛ بار بعد از تأیید راننده «برداشته شد» می‌شود
  @Post(':id/offer')
  @RequireCompanyFeature(CompanyFeature.PublishedLoads)
  offer(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OfferCargoDto) {
    return this.trips.offer(currentUserId(request), id, dto.driverUserId);
  }

  // عکس چهره یا ماشین راننده برای شرکت هنگام انتخاب راننده
  @Get('drivers/:driverId/photos/:kind')
  async driverPhoto(
    @Req() request: AuthRequest,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Param('kind', new ParseEnumPipe(['face', 'vehicle'])) kind: 'face' | 'vehicle',
  ) {
    if (!request.user?.roles?.some((role) => role === 'COMPANY' || role === 'COMPANY_ADMIN')) throw new ForbiddenException();
    const path = await this.profiles.photoPath(driverId, kind);
    const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return new StreamableFile(createReadStream(path), { type, disposition: 'inline' });
  }

  // نام شرکت و شماره‌های تماس پیش‌فرض برای فرم ثبت بار
  @Get('draft')
  @RequireCompanyFeature(CompanyFeature.CreateLoad)
  draft(@Req() request: AuthRequest) {
    return this.listings.buildManualDraft(currentUserId(request));
  }

  // ثبت بار دستی توسط شرکت و انتشار آن برای راننده‌ها
  @Post()
  @RequireCompanyFeature(CompanyFeature.CreateLoad)
  create(@Req() request: AuthRequest, @Body() dto: PublishCargoListingDto) {
    return this.listings.createManual(currentUserId(request), dto);
  }

  // «📣 اعلام همین الان»: بار در صف اعلام خودکار، یا اعلام دوباره به راننده‌های تازه‌ی همان نوع
  @Post(':id/announce')
  @RequireCompanyFeature(CompanyFeature.PublishedLoads)
  announceNow(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.announceNow(companyUserId(request), id);
  }

  // TAKEN = «برداشته شد»، OPEN = برگرداندن؛ فقط شرکتی که منتشر کرده
  @Patch(':id/status')
  @RequireCompanyFeature(CompanyFeature.PublishedLoads)
  setStatus(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCargoStatusDto,
  ) {
    return this.listings.setStatus(currentUserId(request), id, dto.status);
  }
}

@Controller('api/cargo-alert-filters')
@UseGuards(JwtAuthGuard)
export class CargoAlertFilterController {
  constructor(private readonly filters: CargoAlertFilterService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    return this.filters.list(currentUserId(request));
  }

  @Post()
  create(@Req() request: AuthRequest, @Body() dto: CreateCargoAlertFilterDto) {
    return this.filters.create(currentUserId(request), dto);
  }

  @Put(':id')
  update(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCargoAlertFilterDto,
  ) {
    return this.filters.update(currentUserId(request), id, dto);
  }

  @Delete(':id')
  async remove(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.filters.remove(currentUserId(request), id);
    return { deleted: true };
  }
}
