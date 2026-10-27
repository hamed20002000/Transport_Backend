import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { CustomerType } from 'src/domain/enums/company.enum';

// رشته خالی یعنی پاک کردن مقدار؛ به null تبدیل می‌شود تا ستون خالی شود.
export const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value
    .trim()
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  return trimmed === '' ? null : trimmed;
};

/**
 * A number that identifies something (national code, card number, postal code): typed or spoken, it often comes
 * in groups — «۱۵۸ ۳۲۴ ۵۶۴۲», «0012-345-678», or from speech «۱۵۸، ۳۲، ۴۵، ۶۴۲». When the value is only digits and
 * separators (space, comma, «،», dash, dot, slash) the separators go; anything with a letter stays as it is,
 * so the field's own rule still refuses it.
 */
export const digitsToNull = (params: { value: unknown }) => {
  const value = trimToNull(params);
  if (typeof value !== 'string' || !/^[\d\s,،.\-–_/]+$/.test(value)) return value;
  return value.replace(/\D/g, '') || null;
};

/**
 * همه فیلدها اختیاری‌اند. فیلدی که ارسال نشود دست نمی‌خورد و فیلدی که null
 * یا رشته خالی باشد پاک می‌شود.
 */
export class UpdateUserProfileDto {
  /** how loads are shown on the web and in the messengers: TEXT (fields) or IMAGE (a picture of the load too) */
  @ApiPropertyOptional({ enum: ['TEXT', 'IMAGE'] })
  @IsOptional()
  @IsIn(['TEXT', 'IMAGE'])
  cargoDisplay?: 'TEXT' | 'IMAGE';

  @ApiPropertyOptional({ enum: CustomerType, nullable: true, description: '0 = شخص حقیقی، 1 = شرکت' })
  @IsOptional()
  @IsEnum(CustomerType)
  profileType?: CustomerType | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string | null;

  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string | null;

  @ApiPropertyOptional({ example: '0012345678', nullable: true })
  @Transform(digitsToNull)
  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'nationalCode must be 10 digits' })
  nationalCode?: string | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true, description: 'نام شرکت برای کار داخلی (اختیاری)' })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  domesticCompanyName?: string | null;

  @ApiPropertyOptional({ maxLength: 200, nullable: true, description: 'نام شرکت برای کار بین‌المللی، صادرات و واردات (اختیاری)' })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  internationalCompanyName?: string | null;

  @ApiPropertyOptional({ example: '10101234567', description: 'شناسه ملی شرکت', nullable: true })
  @Transform(digitsToNull)
  @IsOptional()
  @Matches(/^[0-9]{11}$/, { message: 'companyNationalId must be 11 digits' })
  companyNationalId?: string | null;

  @ApiPropertyOptional({ maxLength: 30, nullable: true })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  economicCode?: string | null;

  @ApiPropertyOptional({ maxLength: 30, nullable: true })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  registrationNo?: string | null;

  @ApiPropertyOptional({ example: '02112345678', nullable: true })
  @Transform(trimToNull)
  @IsOptional()
  @Matches(/^[0-9+\-\s]{4,20}$/, { message: 'phone is invalid' })
  phone?: string | null;

  @ApiPropertyOptional({ example: '1234567890', nullable: true })
  @Transform(digitsToNull)
  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'postalCode must be 10 digits' })
  postalCode?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string | null;
}
