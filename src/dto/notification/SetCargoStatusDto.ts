import { IsEnum } from 'class-validator';
import { CargoListingStatus } from 'src/domain/enums/notification';

export class SetCargoStatusDto {
  @IsEnum(CargoListingStatus)
  status!: CargoListingStatus;
}
