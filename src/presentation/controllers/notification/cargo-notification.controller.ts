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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { CreateCargoAlertFilterDto, UpdateCargoAlertFilterDto } from 'src/dto/notification/CargoAlertFilterDto';
import { SetCargoStatusDto } from 'src/dto/notification/SetCargoStatusDto';
import { PublishCargoListingDto } from 'src/dto/notification/PublishCargoListingDto';
import { CargoNotificationKind } from 'src/infrastructure/repositories/notification/cargoNotification.repository';
import { CargoListingService } from 'src/services/notification/cargoListing.service';
import { CargoListingStatus } from 'src/domain/enums/notification';
import { CargoAlertFilterService } from 'src/services/notification/cargoAlertFilter.service';
import { CargoNotificationService } from 'src/services/notification/cargoNotification.service';

type AuthRequest = { user?: JwtPayload };

function currentUserId(request: AuthRequest): string {
  const userId = request.user?.userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
}

@Controller('api/cargo-notifications')
@UseGuards(JwtAuthGuard)
export class CargoNotificationController {
  constructor(
    private readonly notifications: CargoNotificationService,
    private readonly listings: CargoListingService,
  ) {}

  // kind=suggestion: پیشنهادهای بار به شرکت، kind=listing: بارهای منتشرشده برای راننده
  @Get()
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
  listingDraft(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.buildDraft(currentUserId(request), id);
  }

  // انتشار بار به نام همین شرکت برای راننده‌ها
  @Post(':id/publish')
  publish(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishCargoListingDto,
  ) {
    return this.listings.publish(currentUserId(request), id, dto);
  }
}

@Controller('api/cargo-listings')
@UseGuards(JwtAuthGuard)
export class CargoListingController {
  constructor(private readonly listings: CargoListingService) {}

  // بارهایی که همین کاربر (شرکت) منتشر کرده است
  @Get()
  listMine(
    @Req() request: AuthRequest,
    @Query('status', new ParseEnumPipe(CargoListingStatus, { optional: true })) status: CargoListingStatus | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.listings.listMine(currentUserId(request), {
      status,
      page: Math.max(page, 1),
      pageSize: Math.min(Math.max(pageSize, 1), 100),
    });
  }

  // نام شرکت و شماره‌های تماس پیش‌فرض برای فرم ثبت بار
  @Get('draft')
  draft(@Req() request: AuthRequest) {
    return this.listings.buildManualDraft(currentUserId(request));
  }

  // ثبت بار دستی توسط شرکت و انتشار آن برای راننده‌ها
  @Post()
  create(@Req() request: AuthRequest, @Body() dto: PublishCargoListingDto) {
    return this.listings.createManual(currentUserId(request), dto);
  }

  // TAKEN = «برداشته شد»، OPEN = برگرداندن؛ فقط شرکتی که منتشر کرده
  @Patch(':id/status')
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
