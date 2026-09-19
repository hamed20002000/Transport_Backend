// infrastructure/repositories/TransportCompanyRepository.ts

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TransportCompany } from 'src/domain/entities/company/TransportCompany';
import { ITransportCompanyRepository } from '../../domain/repositories/ITransportCompanyRepository';

@Injectable()
export class TransportCompanyRepository
  implements ITransportCompanyRepository
{
  constructor(
    @InjectRepository(TransportCompany)
    private readonly repository: Repository<TransportCompany>,
  ) {}

  findAll(): Promise<TransportCompany[]> {
    return this.repository.find({
      order: {
        createdAt: 'DESC',
      },
    });
  }

  findById(id: string): Promise<TransportCompany | null> {
    return this.repository.findOne({
      where: { id },
    });
  }

  findByName(
    name: string,
  ): Promise<TransportCompany | null> {
    return this.repository.findOne({
      where: { name },
    });
  }

  create(
    company: TransportCompany,
  ): Promise<TransportCompany> {
    return this.repository.save(company);
  }

  update(
    company: TransportCompany,
  ): Promise<TransportCompany> {
    return this.repository.save(company);
  }
}