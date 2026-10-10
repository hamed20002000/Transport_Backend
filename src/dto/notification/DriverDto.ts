import { Transform } from 'class-transformer';
import { IsBoolean, IsLatitude, IsLongitude, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

// شرکت بار را به این راننده می‌سپارد («برداشته شد»)
export class OfferCargoDto {
  @IsUUID()
  driverUserId!: string;
}

// جواب راننده به بار سپرده‌شده
export class RespondOfferDto {
  @IsBoolean()
  accept!: boolean;
}

export class CreateCargoRequestDto {
  @IsUUID()
  listingId!: string;
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
