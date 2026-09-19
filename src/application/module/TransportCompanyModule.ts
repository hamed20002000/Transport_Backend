import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TransportCompany } from 'src/domain/entities/company/TransportCompany';
import { TransportCompanyRepository } from 'src/infrastructure/repositories/TransportCompanyRepository';
import { TransportCompanyService } from 'src/services/TransportCompanyService';
import { TransportCompanyController } from 'src/presentation/controllers/TransportCompanyController';
import { TRANSPORT_COMPANY_REPOSITORY } from 'src/domain/repositories/repository.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TransportCompany,
    ]),
  ],

  controllers: [
    TransportCompanyController,
  ],

  providers: [
    TransportCompanyService,

    {
      provide: TRANSPORT_COMPANY_REPOSITORY,
      useClass: TransportCompanyRepository,
    },
  ],

  exports: [
    TransportCompanyService,
  ],
})
export class TransportCompanyModule {}