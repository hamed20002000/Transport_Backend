import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BaseRepository } from '../base.repository';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
import { Roles } from 'src/domain/entities/Roles';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { TenderHeaders } from 'src/domain/entities/TenderHeaders';
import { TenderListDto, UpdateTenderDto } from 'src/presentation/dtos/initial-operations/tender-dto';
import { plainToInstance } from 'class-transformer';
import { TenderDetails } from 'src/domain/entities/TenderDetails';
import { Items } from 'src/domain/entities/Items';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { TenderCategories } from 'src/domain/entities/TenderCategories';
import { Works } from 'src/domain/entities/Works';

@Injectable()
export class WorkRepository extends BaseRepository<Works> {
  constructor(@InjectRepository(Works) repository: Repository<Works>, private readonly dataSource: DataSource) {
    super(repository);
  }
  async getAllWorks(): Promise<Works[]> {
    const works = await this.repository.find({
      relations: [
        'tender',

      ],
      order: {
        createAt: 'DESC',
      },
    });

    return works;
  }
  async getWorkById(id: number): Promise<Works> {
    const work = await this.repository.findOne({
      where: { id },
      relations: [
        'tender'
      ],
    });

    if (!work) {
      throw new NotFoundException(`Work with id ${id} not found`);
    }

    return work;
  }

  async getWorkWithTitle(title: string): Promise<Works[]> {
    return await this.repository.find({
      where: {
        title: ILike(`%${title}%`)
      }
    });
  }



}
