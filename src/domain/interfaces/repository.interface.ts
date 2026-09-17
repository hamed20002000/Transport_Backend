import { FindManyOptions, FindOptionsRelations, FindOptionsSelect } from "typeorm";


export interface IRepository<T> {
  findById(id: number): Promise<T | null>;
  findByStringId(id: string): Promise<T | null>;
  findAllRecords(): Promise<T[]>;
  add(entity: T): Promise<T>;
  addMany(entities: T[]): Promise<T[]>;
  update(entity: T): Promise<T>;
   updateMany(entities: T[]): Promise<T[]>;
  saveOrUpdateArray(entities: T[]): Promise<T[]>;
  delete(id: number): Promise<void>;



}
