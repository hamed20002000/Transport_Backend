import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { trimToNull } from 'src/dto/user/update-user-profile.dto';

const toNumberOrNull = ({ value }: { value: unknown }) => (value === '' || value === null ? null : typeof value === 'string' ? Number(value) : value);

/**
 * پروفایل راننده؛ مثل پروفایل کاربر همه اختیاری‌اند، فیلدی که نیاید دست
 * نمی‌خورد و null/رشته‌ی خالی پاکش می‌کند. نام و کد ملی روی User ذخیره می‌شوند.
 */
export class UpdateDriverProfileDto {
  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @Transform(trimToNull) @IsOptional() @IsString() @MaxLength(100)
  firstName?: string | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @Transform(trimToNull) @IsOptional() @IsString() @MaxLength(100)
  lastName?: string | null;

  @ApiPropertyOptional({ example: '0012345678', nullable: true })
  @Transform(trimToNull) @IsOptional() @Matches(/^[0-9]{10}$/, { message: 'nationalCode must be 10 digits' })
  nationalCode?: string | null;

  @ApiPropertyOptional({ example: '1234567', nullable: true })
  @Transform(trimToNull) @IsOptional() @Matches(/^[0-9]{5,20}$/, { message: 'smartCardNumber must be digits' })
  smartCardNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull) @IsOptional() @Matches(/^[0-9]{5,20}$/, { message: 'licenseNumber must be digits' })
  licenseNumber?: string | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @Transform(trimToNull) @IsOptional() @IsString() @MaxLength(100)
  homeCity?: string | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @Transform(trimToNull) @IsOptional() @IsString() @MaxLength(100)
  vehicleType?: string | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @Transform(trimToNull) @IsOptional() @IsString() @MaxLength(100)
  vehicleModel?: string | null;

  // پلاک ایران: دو رقم، یک حرف فارسی، سه رقم، کد دو رقمی استان
  @ApiPropertyOptional({ example: '12-ع-345-67', nullable: true })
  @Transform(trimToNull) @IsOptional() @Matches(/^[0-9]{2}-[؀-ۿ]-[0-9]{3}-[0-9]{2}$/, { message: 'plate is invalid' })
  plate?: string | null;

  @ApiPropertyOptional({ example: 24, nullable: true })
  @Transform(toNumberOrNull) @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0.5) @Max(100)
  capacityTons?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimToNull) @IsOptional() @Matches(/^[0-9]{5,20}$/, { message: 'fleetCardNumber must be digits' })
  fleetCardNumber?: string | null;
}
