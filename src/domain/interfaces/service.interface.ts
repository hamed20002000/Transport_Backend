
export interface IService<T> {
  getById(id: number): Promise<T | null>;
   getByStringId(id: string): Promise<T | null>;
  getAllRecords(): Promise<T[]>;
  add(entity: T): Promise<T>;
  update(entity: T): Promise<T>;
    updateMany(entities: T[]): Promise<T[]>;
  delete(id: number): Promise<void>;
 
}