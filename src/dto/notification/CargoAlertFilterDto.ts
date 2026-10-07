import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCargoAlertFilterDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150)
  label?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true })
  origins?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true })
  destinations?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true })
  cargoTypes?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true })
  vehicleTypes?: string[];

  // فقط بارهای این شرکت‌ها (برای راننده‌ها)
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true })
  companies?: string[];

  // بازه‌ی کرایه به تومان؛ null حد را برمی‌دارد.
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000_000)
  minPrice?: number | null;

  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000_000)
  maxPrice?: number | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateCargoAlertFilterDto extends PartialType(CreateCargoAlertFilterDto) {}
