import { IRepository } from '../../domain/interfaces/repository.interface';
import { IService } from 'src/domain/interfaces/service.interface';

export class BaseService<T> implements IService<T> {
  constructor(
    private readonly repository: IRepository<T>,
  ) {}

  async getById(id: number): Promise<T | null> {
    return this.repository.findById(id);
  }

  async getByStringId(id: string): Promise<T | null> {
    return this.repository.findByStringId(id);
  }

  async getAllRecords(): Promise<T[]> {
    return this.repository.findAllRecords();
  }

  async add(entity: T): Promise<T> {
    return this.repository.add(entity);
  }

  async addMany(entities: T[]): Promise<T[]> {
    return this.repository.addMany(entities);
  }

  async update(entity: T): Promise<T> {
    return this.repository.update(entity);
  }

  async updateMany(entities: T[]): Promise<T[]> {
    return this.repository.updateMany(entities);
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }
}