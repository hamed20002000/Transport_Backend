import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Not,
  Repository,
} from 'typeorm';

import { PaymentReceipt } from '../../../domain/entities/subscription/PaymentReceipt';

import { IPaymentReceiptRepository } from '../../../domain/repositories/subscription/IPaymentReceiptRepository';

@Injectable()
export class PaymentReceiptRepository
  implements IPaymentReceiptRepository
{
  constructor(
    @InjectRepository(PaymentReceipt)
    private readonly repository:
      Repository<PaymentReceipt>,
  ) {}

  async findById(
    id: string,
  ): Promise<PaymentReceipt | null> {
    return this.repository.findOne({
      where: {
        id,
      },
    });
  }

  async save(
    entity: PaymentReceipt,
  ): Promise<PaymentReceipt> {
    return this.repository.save(entity);
  }

  async existsTrackingCode(
    trackingCode: string,
    excludeReceiptId?: string,
  ): Promise<boolean> {
    if (!trackingCode) {
      return false;
    }

    const count =
      await this.repository.count({
        where: excludeReceiptId
          ? {
              trackingCode,
              id: Not(excludeReceiptId),
            }
          : {
              trackingCode,
            },
      });

    return count > 0;
  }
}