import {
   Repository, 
   FindOptionsWhere,
   DeepPartial,
   ObjectLiteral
     } from 'typeorm';


import { IRepository } from '../../domain/interfaces/repository.interface';


export class BaseRepository<T extends ObjectLiteral> implements IRepository<T> {
  constructor(readonly repository: Repository<T>) { }

  findById(id: number): Promise<T | null> {
    return this.repository.findOne({
      where: { id } as unknown as FindOptionsWhere<T>, // Explicit cast
    });
  }

  findByStringId(id: string): Promise<T | null> {
    return this.repository.findOne({
      where: { id } as unknown as FindOptionsWhere<T>, // Explicit cast
    });
  }


  findAllRecords(): Promise<T[]> {
    return this.repository.find();
  }

  add(entity: T): Promise<T> {

    return this.repository.save(entity);
  }
  async addMany(entities: T[]): Promise<T[]> {
    return this.repository.save(entities);
  }
  update(entity: T): Promise<T> {
    return this.repository.save(entity);
  }
  async updateMany(entities: T[]): Promise<T[]> {
    return this.repository.save(entities);
  }
  async findAndUpdate(id: any, updateData: DeepPartial<T>): Promise<void> {
    await this.repository.update(id, updateData as any);
  }

  async saveOrUpdateArray(entities: T[]): Promise<T[]> {
    return await this.repository.save(entities);
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }




}
