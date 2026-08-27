import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BaseRepository } from '../base.repository';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Roles } from 'src/domain/entities/Roles';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { TenderHeaders } from 'src/domain/entities/TenderHeaders';
import { TenderListDto, UpdateTenderDto, UpdateTenderHeaderDto } from 'src/presentation/dtos/initial-operations/tender-dto';
import { plainToInstance } from 'class-transformer';
import { TenderDetails } from 'src/domain/entities/TenderDetails';
import { Items } from 'src/domain/entities/Items';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { TenderCategories } from 'src/domain/entities/TenderCategories';

@Injectable()
export class TenderRepository extends BaseRepository<TenderHeaders> {
  constructor(@InjectRepository(TenderHeaders) repository: Repository<TenderHeaders>, private readonly dataSource: DataSource) {
    super(repository);
  }
  async getAllTenders(): Promise<TenderHeaders[]> {
    const tenders = await this.repository.find({
      /*   relations: [
          'tenderDetails',
          'tenderDetails.item',
        ], */
      order: {
        createAt: 'DESC',
      },
    });

    return tenders;
  }
  async getTenderById(id: number): Promise<TenderHeaders> {
    const tender = await this.repository.findOne({
      where: { id },
      relations: [
        'tenderCategories',
        'tenderCategories.tenderDetails',
        'tenderCategories.tenderDetails.item',
        'tenderCategories.tenderDetails.item.unit', // ⬅️ این خط اضافه شد
      ],
      order: {
       tenderCategories: {
          tenderDetails:{
            tedas: 'ASC',            
            ana: 'ASC',
            alt: 'ASC',
          },
        },
      },
    });

    if (!tender) {
      throw new NotFoundException(`Tender with id ${id} not found`);
    }

    return tender;
  }

    async updateTenderHeader(tenderDto: UpdateTenderHeaderDto): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const tender = await manager.getRepository(TenderHeaders).findOne({
        where: { id: tenderDto.id },
        relations: ['tenderCategories'], // تا دسته‌ها رو هم بیاره
      });

      if (!tender) throw new NotFoundException('Tender not found');

      tender.title = tenderDto.title?.trim() ?? tender.title;
      tender.recordStatus = tenderDto.recordStatus ?? tender.recordStatus;
      tender.attachments = tenderDto.attachments ? tenderDto.attachments.map(att => ({ fileUrl: att.fileUrl })) : null;


      await manager.getRepository(TenderHeaders).save(tender);
    });
  }


  async updateTender(tenderDto: UpdateTenderDto): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const tender = await manager.getRepository(TenderHeaders).findOne({
        where: { id: tenderDto.id },
        relations: ['tenderCategories','user'], // تا دسته‌ها رو هم بیاره
      });

      if (!tender) throw new NotFoundException('Tender not found');

     
      // حذف دسته‌بندی‌ها و جزئیات قبلی
      await manager.getRepository(TenderDetails).delete({
        tenderCategory: In(tender.tenderCategories.map(c => c.id)),
      });

      await manager.getRepository(TenderCategories).delete({
        tenderHeader: { id: tender.id },
      });

      // درج دسته‌های جدید
      if (tenderDto.categories && tenderDto.categories.length > 0) {
        tender.tenderCategories = tenderDto.categories.map(catDto => {
          const cat = new TenderCategories();
          cat.title=catDto.title;
          cat.eskiPoz=catDto.eskiPoz;
          cat.percent = catDto.percent;
          cat.description = catDto.description;
          cat.createAt = new Date();
          cat.recordStatus = recordStatus.Active;
          cat.user = tender.user;

          // درج جزئیات هر دسته
          if (catDto.details && catDto.details.length > 0) {
            cat.tenderDetails = catDto.details.map(detailDto => {
              const detail = new TenderDetails();
              detail.eskiPoz = detailDto.eskiPoz;
              detail.tedas = detailDto.tedas;
              detail.ana = detailDto.ana;
              detail.alt = detailDto.alt;
              detail.firmProcuredItemQuantities = detailDto.firmProcuredItemQuantities;
              detail.ourProcuredItemQuantities = detailDto.ourProcuredItemQuantities;
              detail.demontaj = detailDto.demontaj;
              detail.demontajMontaj = detailDto.demontajMontaj;
              detail.firmProcuredItemPrice = detailDto.firmProcuredItemPrice;
              detail.ourProcuredItemPrice = detailDto.ourProcuredItemPrice;
              detail.montajPrice = detailDto.montajPrice;
              detail.demontajPrice = detailDto.demontajPrice;
              detail.demontajMontajPrice = detailDto.demontajMontajPrice;
              detail.malzemeTutari = detailDto.malzemeTutari;
              detail.montajTutari = detailDto.montajTutari;
              detail.demontajTutari = detailDto.demontajTutari;
              detail.dMMTutari = detailDto.dMMTutari;

              // FK ها
              detail.item = new Items();
              detail.item.id = detailDto.itemId;
              detail.createAt = new Date();
              detail.recordStatus = recordStatus.Active;
              detail.user = tender.user;

              return detail;
            });
          }

          return cat;
        });
      }

      await manager.getRepository(TenderHeaders).save(tender);
    });
  }

    async getTenderByTitle(title: string): Promise<TenderHeaders[]> {
    const tender = await this.repository.find({
      where: { title },
      relations: [
        'tenderCategories',
        'tenderCategories.tenderDetails',
        'tenderCategories.tenderDetails.item',
        'tenderCategories.tenderDetails.item.unit', // ⬅️ این خط اضافه شد
      ],
      order: {
       tenderCategories: {
          tenderDetails:{
            tedas: 'ASC',            
            ana: 'ASC',
            alt: 'ASC',
          },
        },
      },
    });

    if (!tender) {
      throw new NotFoundException(`Tender with id ${title} not found`);
    }

    return tender;
  }

}
