import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BaseRepository } from '../base.repository';
import { Repository } from 'typeorm';
import { Roles } from 'src/domain/entities/Roles';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { ItemUnits } from 'src/domain/entities/ItemUnits';

@Injectable()
export class ItemUnitRepository extends BaseRepository<ItemUnits> {
  constructor(@InjectRepository(ItemUnits) repository: Repository<ItemUnits>) {
    super(repository);
  }

      async findByName(title: string): Promise<ItemUnits> {
          return await this.repository.findOneBy({title})
              
      }
  
}
