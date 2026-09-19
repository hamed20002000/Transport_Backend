import { IsIn, IsInt } from 'class-validator';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

export class UpdateTransportCompanyStatusDto {
  @IsInt()
  @IsIn([0, 1])
  recordStatus!: RecordStatus;
}