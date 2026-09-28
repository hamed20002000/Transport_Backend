import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CargoAlertFilter } from '../../../domain/entities/notification/CargoAlertFilter';

@Injectable()
export class CargoAlertFilterRepository {
  constructor(@InjectRepository(CargoAlertFilter) private readonly repository: Repository<CargoAlertFilter>) {}

  findActiveByUserIds(userIds: string[]): Promise<CargoAlertFilter[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { userId: In(userIds), isActive: true } });
  }

  findByUserId(userId: string): Promise<CargoAlertFilter[]> {
    return this.repository.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  findOneForUser(id: string, userId: string): Promise<CargoAlertFilter | null> {
    return this.repository.findOne({ where: { id, userId } });
  }

  create(data: Partial<CargoAlertFilter>): CargoAlertFilter {
    return this.repository.create(data);
  }

  save(filter: CargoAlertFilter): Promise<CargoAlertFilter> {
    return this.repository.save(filter);
  }

  async remove(filter: CargoAlertFilter): Promise<void> {
    await this.repository.remove(filter);
  }
}
