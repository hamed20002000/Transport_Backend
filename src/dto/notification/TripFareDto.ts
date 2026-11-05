import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

import { BrokerPayModel, FareBasis, FareChangeReason, FareCurrency, TripFareStage } from 'src/domain/enums/tripFare';
import { MAX_WEIGHT_TONS } from 'src/domain/helper/tripFare';

/** One stage's fare and weight (TripFare); the rules are readTripFare's, these only keep out the wrong types. */
export class TripFareDto {
  @IsEnum(FareBasis)
  basis!: FareBasis;

  // the whole fare (TOTAL) or the fare of one ton (PER_TON)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  rate!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_WEIGHT_TONS)
  weightTons!: number;

  @IsOptional()
  @IsEnum(FareCurrency)
  currency?: FareCurrency;

  // delivery only: why it differs from the agreed fare
  @IsOptional()
  @IsEnum(FareChangeReason)
  changeReason?: FareChangeReason;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

// قبول درخواست: کرایه و وزن توافقی (لازم)، و برای درخواست واسط نحوه‌ی دریافت او؛ رد درخواست بدنه ندارد
export class DecideRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => TripFareDto)
  fare?: TripFareDto;

  @IsOptional()
  @IsEnum(BrokerPayModel)
  payModel?: BrokerPayModel;
}

// تأیید تحویل: کرایه و وزن نهایی
export class DeliverTripDto {
  @ValidateNested()
  @Type(() => TripFareDto)
  fare!: TripFareDto;
}

// شرکت بار را به این راننده می‌سپارد («برداشته شد») با کرایه و وزن توافقی
export class OfferCargoDto {
  @IsUUID()
  driverUserId!: string;

  @ValidateNested()
  @Type(() => TripFareDto)
  fare!: TripFareDto;
}

export class FareFormQueryDto {
  @IsIn(Object.values(TripFareStage))
  stage!: TripFareStage;
}
