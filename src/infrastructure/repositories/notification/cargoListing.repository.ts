import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CargoListing } from '../../../domain/entities/notification/CargoListing';
import { CargoListingStatus } from '../../../domain/enums/notification';

@Injectable()
export class CargoListingRepository {
  constructor(@InjectRepository(CargoListing) private readonly repository: Repository<CargoListing>) {}

  create(data: Partial<CargoListing>): CargoListing {
    return this.repository.create(data);
  }

  save(listing: CargoListing): Promise<CargoListing> {
    return this.repository.save(listing);
  }

  findOneForPublisher(id: string, publisherUserId: string): Promise<CargoListing | null> {
    return this.repository.findOne({ where: { id, publisherUserId } });
  }

  findBySourceAndPublisher(sourceMessageId: string, publisherUserId: string): Promise<CargoListing | null> {
    return this.repository.findOne({ where: { sourceMessageId, publisherUserId } });
  }

  findManyBySourceAndPublisher(sourceMessageIds: string[], publisherUserId: string): Promise<CargoListing[]> {
    if (sourceMessageIds.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { sourceMessageId: In(sourceMessageIds), publisherUserId } });
  }

  findPageForPublisher(
    publisherUserId: string,
    options: { status?: CargoListingStatus; skip: number; take: number },
  ): Promise<[CargoListing[], number]> {
    return this.repository.findAndCount({
      where: { publisherUserId, ...(options.status ? { status: options.status } : {}) },
      order: { createdAt: 'DESC' },
      skip: options.skip,
      take: options.take,
    });
  }

  /**
   * فقط اگر وضعیت واقعاً عوض شود true برمی‌گرداند. شرط روی وضعیت قبلی باعث
   * می‌شود دو کلیک همزمان فقط یک بار پیام‌ها را ویرایش کنند.
   */
  async changeStatus(id: string, status: CargoListingStatus): Promise<boolean> {
    const taken = status === CargoListingStatus.Taken;
    const result = await this.repository.update(
      { id, status: taken ? CargoListingStatus.Open : CargoListingStatus.Taken },
      { status, takenAt: taken ? new Date() : null },
    );

    return (result.affected ?? 0) > 0;
  }
}
