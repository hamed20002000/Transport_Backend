import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "src/auth/guards/jwt-auth.guard";
import { CreateTransportCompanyDto } from "src/dto/transport-company/CreateTransportCompanyDto";
import { UpdateTransportCompanyDto } from "src/dto/transport-company/UpdateTransportCompanyDto";
import { UpdateTransportCompanyStatusDto } from "src/dto/transport-company/UpdateTransportCompanyStatusDto";
import { TransportCompanyService } from "src/services/TransportCompanyService";

@Controller('api/transport-companies')
@UseGuards(JwtAuthGuard)
export class TransportCompanyController {
  constructor(
    private readonly service: TransportCompanyService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findById(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(id);
  }

  @Post()
  create(
    @Body() dto: CreateTransportCompanyDto,
  ) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransportCompanyDto,
  ) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransportCompanyStatusDto,
  ) {
    return this.service.updateRecordStatus(
      id,
      dto.recordStatus,
    );
  }
}