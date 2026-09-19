import { PartialType } from '@nestjs/swagger';
import { CreateTransportCompanyDto } from './CreateTransportCompanyDto';

export class UpdateTransportCompanyDto extends PartialType(
  CreateTransportCompanyDto,
) {}