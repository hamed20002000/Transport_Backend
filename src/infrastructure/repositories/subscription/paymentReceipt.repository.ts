import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LessThan,
  Not,
  Repository,
} from 'typeorm';

import { PaymentReceipt } from '../../../domain/entities/subscription/PaymentReceipt';
import { SubscriptionOrder } from '../../../domain/entities/subscription/SubscriptionOrder';
import { PaymentReceiptStatus } from '../../../domain/enums/subscription';

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

  async saveWithOrder(
    receipt: PaymentReceipt,
    order: SubscriptionOrder,
  ): Promise<PaymentReceipt> {
    return this.repository.manager.transaction(async manager => {
      const savedOrder = await manager.save(SubscriptionOrder, order);
      receipt.orderId = savedOrder.id;
      return manager.save(PaymentReceipt, receipt);
    });
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

  async claimForAnalysis(
    receiptId: string,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(PaymentReceipt)
      .set({
        status: PaymentReceiptStatus.Analyzing,
        analysisStartedAt: () => 'now()',
        analysisAttempts: () => '"analysisAttempts" + 1',
      })
      .where('id = :receiptId', { receiptId })
      .andWhere('status = :pending', { pending: PaymentReceiptStatus.PendingAnalysis })
      .execute();

    return result.affected === 1;
  }

  async releaseFailedAnalysis(
    receiptId: string,
    maxAttempts: number,
    error: string,
  ): Promise<void> {
    await this.repository.query(
      `UPDATE "PaymentReceipt"
       SET "status" = CASE WHEN "analysisAttempts" >= $2 THEN $3 ELSE $4 END::"PaymentReceipt_status_enum",
           "aiRawResult" = jsonb_build_object('error', $5::text),
           "updatedAt" = now()
       WHERE "id" = $1 AND "status" = $6`,
      [
        receiptId,
        maxAttempts,
        PaymentReceiptStatus.NeedsReview,
        PaymentReceiptStatus.PendingAnalysis,
        error.slice(0, 2000),
        PaymentReceiptStatus.Analyzing,
      ],
    );
  }

  async releaseStaleAnalyses(
    startedBefore: Date,
    maxAttempts: number,
  ): Promise<number> {
    const [, affected] = await this.repository.query(
      `UPDATE "PaymentReceipt"
       SET "status" = CASE WHEN "analysisAttempts" >= $2 THEN $3 ELSE $4 END::"PaymentReceipt_status_enum",
           "updatedAt" = now()
       WHERE "status" = $5 AND "analysisStartedAt" < $1`,
      [
        startedBefore,
        maxAttempts,
        PaymentReceiptStatus.NeedsReview,
        PaymentReceiptStatus.PendingAnalysis,
        PaymentReceiptStatus.Analyzing,
      ],
    );

    return Number(affected ?? 0);
  }

  async findPendingAnalysisIds(
    createdBefore: Date,
    limit: number,
  ): Promise<string[]> {
    const receipts = await this.repository.find({
      select: { id: true },
      where: {
        status: PaymentReceiptStatus.PendingAnalysis,
        createdAt: LessThan(createdBefore),
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });

    return receipts.map(receipt => receipt.id);
  }
}
