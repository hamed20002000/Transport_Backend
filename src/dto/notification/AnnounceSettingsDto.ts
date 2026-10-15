import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { CargoAnnounceMode } from 'src/domain/enums/notification';
import { ANNOUNCE_INTERVALS } from 'src/services/notification/companyAnnounce.service';

/** حالت اعلام بار شرکت؛ intervalMinutes فقط برای خودکار (مثلاً ۱۲۰ = هر دو ساعت). */
export class AnnounceSettingsDto {
  @IsEnum(CargoAnnounceMode)
  mode!: CargoAnnounceMode;

  @IsOptional() @Type(() => Number) @IsInt() @Min(ANNOUNCE_INTERVALS.min) @Max(ANNOUNCE_INTERVALS.max)
  intervalMinutes?: number;
}
