// domain/repositories/ITransportCompanyRepository.ts

import { TransportCompany } from "../entities/company/TransportCompany";

export interface ITransportCompanyRepository {
  findAll(): Promise<TransportCompany[]>;

  findById(id: string): Promise<TransportCompany | null>;

  findByName(name: string): Promise<TransportCompany | null>;

  create(
    company: TransportCompany,
  ): Promise<TransportCompany>;

  update(
    company: TransportCompany,
  ): Promise<TransportCompany>;
}