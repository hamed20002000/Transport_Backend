import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : item)) : value;

/** فیلدهای باری که شرکت (بعد از تأیید یا ویرایش نمونه) برای راننده‌ها منتشر می‌کند. */
export class PublishCargoListingDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  companyName?: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200)
  origin!: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200)
  destination!: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  cargoType?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  weight?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  vehicleType?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100)
  price?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000)
  extraNotes?: string;

  @Transform(trimEach)
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5)
  @IsString({ each: true })
  @Matches(/^[0-9۰-۹+\-\s()]{5,20}$/, { each: true, message: 'Each contact phone must be a valid phone number.' })
  contactPhones!: string[];
}
