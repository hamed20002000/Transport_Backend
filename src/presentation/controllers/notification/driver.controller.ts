import { createReadStream } from 'node:fs';

import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
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
  ServiceUnavailableException,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { CargoRequest } from 'src/domain/entities/notification/CargoRequest';
import { CreateCargoRequestDto, DriverLocationDto, DriverPlaceDto, RespondOfferDto } from 'src/dto/notification/DriverDto';
import { UpdateDriverProfileDto } from 'src/dto/notification/DriverProfileDto';
import {
  DRIVER_PHOTO_KINDS,
  DriverPhotoKind,
  DriverProfileService,
  driverPhotoUploadOptions,
} from 'src/services/driver/driverProfile.service';
import { CargoRequestRepository } from 'src/infrastructure/repositories/notification/cargoRequest.repository';
import { CargoInsightService } from 'src/services/notification/cargoInsight.service';
import { CargoListingService } from 'src/services/notification/cargoListing.service';
import { CargoTripService } from 'src/services/notification/cargoTrip.service';
import { GeoPoint } from 'src/services/routing/geo';
import { RoutingService } from 'src/services/routing/routing.service';
import { routeStationsSpeech } from 'src/services/speech/stationSpeech';
import { TextToSpeechService } from 'src/services/speech/textToSpeech.service';
import { I18nService } from 'nestjs-i18n';

type AuthRequest = { user?: JwtPayload };

// بیشترین نقطه‌ی هر مسیر در پاسخ؛ برای کشیدن طرح مسیر کافی است.
const ROUTE_POINTS = 120;

function currentDriverId(request: AuthRequest): string {
  const user = request.user;
  if (!user?.userId) throw new UnauthorizedException();
  if (!user.roles?.includes('DRIVER')) throw new ForbiddenException('onlyDriver');
  return user.userId;
}

const pageOf = (page: number, pageSize: number) => ({
  page: Math.max(page, 1),
  pageSize: Math.min(Math.max(pageSize, 1), 50),
});

function thin(points: GeoPoint[]): GeoPoint[] {
  if (points.length <= ROUTE_POINTS) return points;
  const step = (points.length - 1) / (ROUTE_POINTS - 1);
  return Array.from({ length: ROUTE_POINTS }, (_, i) => points[Math.round(i * step)]);
}

/**
 * پنل وب راننده: همان کارهایی که در ربات‌ها هست (پیدا کردن بار، درخواست،
 * سفر فعال، تحویل، موقعیت) روی CargoTripService / CargoInsightService.
 */
@Controller('api/driver')
@UseGuards(JwtAuthGuard)
export class DriverController {
  constructor(
    private readonly trips: CargoTripService,
    private readonly insight: CargoInsightService,
    private readonly listings: CargoListingService,
    private readonly requests: CargoRequestRepository,
    private readonly profiles: DriverProfileService,
    private readonly routing: RoutingService,
    private readonly speech: TextToSpeechService,
    private readonly i18n: I18nService,
  ) {}

  @Get('profile')
  profile(@Req() request: AuthRequest) {
    return this.profiles.get(currentDriverId(request));
  }

  @Patch('profile')
  updateProfile(@Req() request: AuthRequest, @Body() dto: UpdateDriverProfileDto) {
    return this.profiles.update(currentDriverId(request), dto);
  }

  // عکس اختیاری ماشین یا پلاک (multipart، فیلد file)
  @Put('profile/photos/:kind')
  @UseInterceptors(FileInterceptor('file', driverPhotoUploadOptions))
  uploadPhoto(
    @Req() request: AuthRequest,
    @Param('kind', new ParseEnumPipe(DRIVER_PHOTO_KINDS)) kind: DriverPhotoKind,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.profiles.setPhoto(currentDriverId(request), kind, file);
  }

  @Delete('profile/photos/:kind')
  deletePhoto(@Req() request: AuthRequest, @Param('kind', new ParseEnumPipe(DRIVER_PHOTO_KINDS)) kind: DriverPhotoKind) {
    return this.profiles.deletePhoto(currentDriverId(request), kind);
  }

  @Get('profile/photos/:kind')
  async photo(@Req() request: AuthRequest, @Param('kind', new ParseEnumPipe(DRIVER_PHOTO_KINDS)) kind: DriverPhotoKind) {
    const path = await this.profiles.photoPath(currentDriverId(request), kind);
    const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return new StreamableFile(createReadStream(path), { type, disposition: 'inline' });
  }

  // بارهای باز؛ matchFilters=true فقط آن‌هایی که با فیلترهای راننده جورند.
  @Get('loads')
  loads(
    @Req() request: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('origin') origin?: string,
    @Query('destination') destination?: string,
    @Query('matchFilters', new DefaultValuePipe(false), ParseBoolPipe) matchFilters?: boolean,
  ) {
    return this.trips.listOpenForDriver(currentDriverId(request), {
      ...pageOf(page, pageSize),
      matchFilters,
      origin: origin?.trim() || undefined,
      destination: destination?.trim() || undefined,
    });
  }

  // مسیرها (مسافت، زمان، سوخت، ترافیک)، بار برگشتی و فاصله‌ی راننده تا مبدأ
  @Get('loads/:id/insight')
  async loadInsight(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    const insight = await this.insight.build(id, currentDriverId(request));
    if (!insight) throw new NotFoundException('Cargo listing not found.');
    return {
      listing: this.listings.toView(insight.listing),
      originPoint: insight.originPoint,
      destinationPoint: insight.destinationPoint,
      routes: insight.routes.map((route) => ({ ...route, points: thin(route.points) })),
      returnLoads: insight.returnLoads,
      driver: insight.driver,
    };
  }

  // جایگاه‌های سوخت کنار یکی از مسیرهای بار
  @Get('loads/:id/fuel')
  async loadFuel(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('route', new DefaultValuePipe(0), ParseIntPipe) routeIndex: number,
  ) {
    const insight = await this.insight.build(id, currentDriverId(request));
    const route = insight?.routes[routeIndex];
    if (!route) throw new NotFoundException('Route not found.');
    return this.insight.fuelAlong(route);
  }

  // همان جایگاه‌های مسیر با صدا (mp3) برای راننده‌ای که پشت فرمان است؛ متن مثل ربات
  @Get('loads/:id/fuel/voice')
  async loadFuelVoice(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('route', new DefaultValuePipe(0), ParseIntPipe) routeIndex: number,
  ) {
    if (!this.speech.available) throw new ServiceUnavailableException('Text to speech is not available.');
    const insight = await this.insight.build(id, currentDriverId(request));
    const route = insight?.routes[routeIndex];
    if (!route) throw new NotFoundException('Route not found.');
    // همان جایگاه‌هایی که فهرست وب نشان می‌دهد: گازوئیلی یا با نوع سوخت نامعلوم
    const stations = (await this.insight.fuelAlong(route)).stations.filter((station) => station.diesel !== false);
    const text = routeStationsSpeech((key, args) => this.i18n.translate(`trip.${key}`, { lang: 'fa', args }) as string, stations);
    return new StreamableFile(await this.speech.synthesize(text, 'mp3'), { type: 'audio/mpeg', disposition: 'inline' });
  }

  @Get('loads/:id/return-loads')
  async returnLoads(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
  ) {
    currentDriverId(request);
    const listing = await this.listings.findById(id);
    if (!listing) throw new NotFoundException('Cargo listing not found.');
    const paging = pageOf(page, pageSize);
    const result = await this.insight.returnLoadList(listing, paging.page, paging.pageSize);
    return { ...result, ...paging };
  }

  // نام شرکت‌هایی که بار اعلام کرده‌اند (پیشنهاد برای فیلتر)
  @Get('companies')
  companies(@Req() request: AuthRequest) {
    currentDriverId(request);
    return this.listings.companyNames(50);
  }

  @Get('requests')
  async myRequests(
    @Req() request: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    const paging = pageOf(page, pageSize);
    const [items, total] = await this.trips.driverRequests(currentDriverId(request), paging.page, paging.pageSize);
    return { items: items.map((item) => this.requestView(item)), total, ...paging };
  }

  // خطاهای 409 با کلید: taken، own، already، rejected
  @Post('requests')
  async createRequest(@Req() request: AuthRequest, @Body() dto: CreateCargoRequestDto) {
    return this.requestView(await this.trips.request(currentDriverId(request), dto.listingId));
  }

  // بار سپرده‌شده توسط شرکت: تأیید (سفر شروع می‌شود و بار «برداشته شد») یا رد
  @Patch('requests/:id/offer')
  async respondOffer(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondOfferDto) {
    return this.requestView(await this.trips.respondOffer(currentDriverId(request), id, dto.accept));
  }

  @Patch('requests/:id/cancel')
  async cancel(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.requestView(await this.trips.cancel(currentDriverId(request), id));
  }

  @Patch('requests/:id/deliver')
  async deliver(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.requestView(await this.trips.deliver(currentDriverId(request), id));
  }

  @Get('trips/active')
  async activeTrips(@Req() request: AuthRequest) {
    return (await this.trips.activeTrips(currentDriverId(request))).map((item) => this.requestView(item));
  }

  @Get('location')
  async location(@Req() request: AuthRequest) {
    const location = await this.trips.lastLocation(currentDriverId(request));
    return {
      location: location
        ? { latitude: location.latitude, longitude: location.longitude, liveUntil: location.liveUntil ?? null, receivedAt: location.receivedAt }
        : null,
    };
  }

  // موقعیت فعلی از مرورگر؛ مثل ربات برای شرکت‌های سفر فعال/درخواست موقعیت فرستاده می‌شود.
  @Post('location')
  saveLocation(@Req() request: AuthRequest, @Body() dto: DriverLocationDto) {
    return this.trips.saveLocation(currentDriverId(request), { latitude: dto.latitude, longitude: dto.longitude, edited: false });
  }

  // جایگزین وقتی مرورگر موقعیت نمی‌دهد: مختصات شهر/آدرس با همان ژئوکد مسیریابی.
  // 404 با کلید placeNotFound اگر پیدا نشد.
  @Post('location/place')
  async saveLocationByPlace(@Req() request: AuthRequest, @Body() dto: DriverPlaceDto) {
    const driverId = currentDriverId(request);
    const point = await this.routing.geocode(dto.place);
    if (!point) throw new NotFoundException('placeNotFound');
    const result = await this.trips.saveLocation(driverId, { latitude: point.lat, longitude: point.lng, edited: false });
    // ژئوکد متن آزاد گاهی جای دیگری را پیدا می‌کند؛ نام شهر برای اینکه راننده ببیند کجا ثبت شد.
    const resolved = await this.routing.placeName(point).catch(() => null);
    return { ...result, latitude: point.lat, longitude: point.lng, resolved };
  }

  // اطلاعات راننده (User) عمداً برگردانده نمی‌شود.
  private requestView(item: CargoRequest) {
    return {
      id: item.id,
      status: item.status,
      createdAt: item.createdAt,
      decidedAt: item.decidedAt ?? null,
      deliveredAt: item.deliveredAt ?? null,
      offerExpiresAt: item.offerExpiresAt ?? null,
      listing: item.listing ? this.listings.toView(item.listing) : null,
    };
  }
}
