// application/services/TransportCompanyService.ts

import {
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { TransportCompany } from 'src/domain/entities/company/TransportCompany';
import { ITransportCompanyRepository } from 'src/domain/repositories/ITransportCompanyRepository';
import { TRANSPORT_COMPANY_REPOSITORY } from 'src/domain/repositories/repository.tokens';

import { CreateTransportCompanyDto } from '../dto/transport-company/CreateTransportCompanyDto';
import { UpdateTransportCompanyDto } from '../dto/transport-company/UpdateTransportCompanyDto';
import { RecordStatus } from 'src/domain/enums/RecordStatus';

@Injectable()
export class TransportCompanyService {
    constructor(
        @Inject(TRANSPORT_COMPANY_REPOSITORY)
        private readonly repository: ITransportCompanyRepository,
    ) { }

    findAll(): Promise<TransportCompany[]> {
        return this.repository.findAll();
    }

    async findById(id: string): Promise<TransportCompany> {
        const company = await this.repository.findById(id);

        if (!company) {
            throw new NotFoundException(
                'Transport company not found',
            );
        }

        return company;
    }

    async create(
        dto: CreateTransportCompanyDto,
    ): Promise<TransportCompany> {
        const name = dto.name.trim();

        const existing =
            await this.repository.findByName(name);

        if (existing) {
            throw new ConflictException(
                'Transport company already exists',
            );
        }

        const company = new TransportCompany();

        company.name = name;
        company.nationalId = dto.nationalId;
        company.economicCode = dto.economicCode;
        company.registrationNo = dto.registrationNo;
        company.phone = dto.phone;
        company.email = dto.email;
        company.address = dto.address;
        company.latitude = dto.latitude;
        company.longitude = dto.longitude;
        company.recordStatus = 0;

        return this.repository.create(company);
    }

    async update(
        id: string,
        dto: UpdateTransportCompanyDto,
    ): Promise<TransportCompany> {
        const company = await this.findById(id);

        if (dto.name !== undefined) {
            const name = dto.name.trim();

            const existing =
                await this.repository.findByName(name);

            if (existing && existing.id !== id) {
                throw new ConflictException(
                    'Transport company already exists',
                );
            }

            company.name = name;
        }

        if (dto.nationalId !== undefined)
            company.nationalId = dto.nationalId;

        if (dto.economicCode !== undefined)
            company.economicCode = dto.economicCode;

        if (dto.registrationNo !== undefined)
            company.registrationNo = dto.registrationNo;

        if (dto.phone !== undefined)
            company.phone = dto.phone;

        if (dto.email !== undefined)
            company.email = dto.email;

        if (dto.address !== undefined)
            company.address = dto.address;

        if (dto.latitude !== undefined)
            company.latitude = dto.latitude;

        if (dto.longitude !== undefined)
            company.longitude = dto.longitude;

        return this.repository.update(company);
    }

    async updateRecordStatus(
        id: string,
        recordStatus: RecordStatus,
    ): Promise<TransportCompany> {
        const company = await this.findById(id);

        company.recordStatus = recordStatus;

        return this.repository.update(company);
    }
}