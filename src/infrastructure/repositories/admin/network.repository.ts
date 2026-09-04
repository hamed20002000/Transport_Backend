import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { Networks } from 'src/domain/entities/Networks';
import { CreateTransmissionRowDto, UpdateNetworkDto } from 'src/presentation/dtos/initial-operations/network-dto';
import { ChannelRows } from 'src/domain/entities/ChannelRows';
import { ChannelRowItems } from 'src/domain/entities/ChannelRowItems';
import { NetworkTrAdis } from 'src/domain/entities/NetworkTrAdis';
import { flattenChannelRows, mapChannelRowDtosToEntities, saveTreeChannelRows } from 'src/presentation/helpers/recursive-functions';

@Injectable()
export class NetworkRepository extends BaseRepository<Networks> {
  constructor(@InjectRepository(Networks) repository: Repository<Networks>, private readonly dataSource: DataSource) {
    super(repository);
  }
  async getAllNetworks(): Promise<Networks[]> {
    const networks = await this.repository.find({
      relations: [
        'work',

      ],
      order: {
        createAt: 'DESC',
      },
    });

    return networks;
  }
  async getNetworkById(id: number): Promise<Networks> {
    const network = await this.repository.findOne({
      where: { id },
      relations: [
        'networkTrAdis',
        'networkTrAdis.channelRows',
        'networkTrAdis.channelRows.productType',
        'networkTrAdis.channelRows.parent',
        'networkTrAdis.channelRows.channelRowItems',
        'networkTrAdis.channelRows.channelRowItems.item',
        'networkTrAdis.channelRows.channelRowItems.item.unit',
        'networkTrAdis.channelRows.channelRowItems.item.category',
        'transmissionRows',
        'transmissionRows.transmissionRowItmes',
        'transmissionRows.transmissionRowItmes.item',
        'transmissionRows.transmissionRowItmes.item.unit',
        'transmissionRows.transmissionRowItmes.item.category',
        'transmissionRows.fromProductType',
        'transmissionRows.toProductType',
        'transmissionSummary',
        'transmissionSummary.item',
        'transmissionSummary.item.unit',
        'transmissionSummary.item.category'
      ],
    });

    if (!network) {
      throw new NotFoundException(`Network with id ${id} not found`);
    }

    return network;
  }

    async getNetworkByWorkId(workId: number): Promise<Networks> {
    const network = await this.repository.findOne({
      where: { work:{id:workId} },
      relations: [
        'networkTrAdis',
        'networkTrAdis.channelRows',
        'networkTrAdis.channelRows.productType',
        'networkTrAdis.channelRows.parent',
        'networkTrAdis.channelRows.channelRowItems',
        'networkTrAdis.channelRows.channelRowItems.item',
        'networkTrAdis.channelRows.channelRowItems.item.unit',
        'networkTrAdis.channelRows.channelRowItems.item.category',
        'transmissionRows',
        'transmissionRows.transmissionRowItmes',
        'transmissionRows.transmissionRowItmes.item',
        'transmissionRows.transmissionRowItmes.item.unit',
        'transmissionRows.transmissionRowItmes.item.category',
        'transmissionRows.fromProductType',
        'transmissionRows.toProductType',
        'transmissionSummary',
        'transmissionSummary.item',
        'transmissionSummary.item.unit',
        'transmissionSummary.item.category',
        'work'
      ],
    });

    if (!network) {
      throw new NotFoundException(`Network with workId ${workId} not found`);
    }

    return network;
  }
  async getTransmissionRowByNetworkId(id: number): Promise<Networks> {
    const network = await this.repository.findOne({
      where: { id },
      relations: [
        'transmissionRows',
        'transmissionRows.transmissionRowItmes',
        'transmissionRows.transmissionRowItmes.item',
        'transmissionRows.transmissionRowItmes.item.unit',
        'transmissionRows.transmissionRowItmes.item.category',
        'transmissionRows.fromProductType',
        'transmissionRows.toProductType',

      ],
    });

    if (!network) {
      throw new NotFoundException(`Network with id ${id} not found`);
    }

    return network;
  }


  async updateNetwork(networkDto: UpdateNetworkDto): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      // پیدا کردن شبکه با تمام روابط
      const network = await manager.getRepository(Networks).findOne({
        where: { id: networkDto.id },
        relations: [
          'networkTrAdis',
          'networkTrAdis.channelRows',
          'networkTrAdis.channelRows.channelRowItems',
          'user', 'work'
        ],
      });

      if (!network) throw new NotFoundException('Network not found');

      // آپدیت فیلدهای شبکه
      network.title = networkDto.title?.trim() ?? network.title;
      network.description = networkDto.description?.trim() ?? network.description;
      network.recordStatus = networkDto.recordStatus ?? network.recordStatus;
      network.work.id = networkDto.workId ?? network.work.id;

      // ⛔️ مهم: ذخیره مجدد network تا id اون resolve بشه (مخصوصاً برای PostgreSQL و relation fix)
      await manager.getRepository(Networks).save(network);
      if (network.networkTrAdis != null) {
        if (network.networkTrAdis.length > 0) {
          // حذف ساختار قبلی (channelRowItems → channelRows → networkTrAdis)
          for (const trAdi of network.networkTrAdis) {
            const channelRowIds = trAdi.channelRows.map(row => row.id);

            if (channelRowIds.length > 0) {
              await manager.getRepository(ChannelRowItems).delete({ channelRow: In(channelRowIds) });
              await manager.getRepository(ChannelRows).delete({ id: In(channelRowIds) });
            }

            await manager.getRepository(NetworkTrAdis).remove(trAdi);
          }

          // ساخت و ذخیره ساختار جدید

        }
      }
      if (networkDto.networkTrAdis != null) {
        if (networkDto.networkTrAdis.length > 0) {
          for (const trAdiDto of networkDto.networkTrAdis || []) {
            const trAdi = new NetworkTrAdis();
            trAdi.title = trAdiDto.title?.trim();
            trAdi.recordStatus = recordStatus.Active;
            trAdi.createAt = new Date();
            trAdi.user = network.user; // مهم برای userId
            trAdi.network = network;   // الان دیگه network.id قطعی هست

            await manager.getRepository(NetworkTrAdis).save(trAdi);

            const channelRows = mapChannelRowDtosToEntities(
              trAdiDto.channelRows || [],
              null,
              network.user,
              network.work,
              trAdi
            );

            await saveTreeChannelRows(channelRows, manager);
          }
        }
      }

    });
  }




  async deleteNetwork(id: number): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const network = await manager.getRepository(Networks).findOne({
        where: { id },
        relations: [
          'networkTrAdis',
          'networkTrAdis.channelRows',
          'networkTrAdis.channelRows.channelRowItems',
        ],
      });

      if (!network) throw new NotFoundException('Network not found');

      for (const trAdi of network.networkTrAdis) {
        const channelRowIds = trAdi.channelRows.map(c => c.id);

        if (channelRowIds.length > 0) {
          // حذف ChannelRowItems مربوط به این ChannelRows
          await manager.getRepository(ChannelRowItems).delete({
            channelRow: In(channelRowIds),
          });

          // حذف ChannelRows
          await manager.getRepository(ChannelRows).delete({
            id: In(channelRowIds),
          });
        }

        // حذف NetworkTrAdis
        await manager.getRepository(NetworkTrAdis).delete({ id: trAdi.id });
      }

      // در نهایت حذف خود Network
      await manager.getRepository(Networks).delete({ id });
    });
  }
  async getWorkNetworkWithTitle(title: string): Promise<Networks[]> { 
    return await this.repository.find({
      where: {
        title: ILike(`%${title}%`)
      }
    });
  }



}
