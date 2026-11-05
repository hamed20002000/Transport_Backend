import { Transform } from 'class-transformer';
import { IsBoolean, IsLatitude, IsLongitude, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// جواب راننده به بار سپرده‌شده
export class RespondOfferDto {
  @IsBoolean()
  accept!: boolean;
}

export class CreateCargoRequestDto {
  @IsUUID()
  listingId!: string;

  // a broker's request: the driver it is for (checked by readBrokerDriver in CargoTripService.request)
  @IsOptional()
  @IsObject()
  forDriver?: Record<string, unknown>;

  // an export or import load: the border picked (GET loads/:id/exit-borders), checked in CargoTripService.request
  @IsOptional()
  @IsString()
  @MaxLength(60)
  exitBorder?: string;
}

// موقعیتی که راننده از مرورگر (Geolocation) می‌فرستد.
export class DriverLocationDto {
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;
}

// وقتی مرورگر موقعیت را پیدا نمی‌کند (لپ‌تاپ بدون GPS): شهر یا آدرس متنی.
export class DriverPlaceDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  place!: string;
}
