import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PaymentReceipt } from 'src/domain/entities/subscription/PaymentReceipt';

import {
  PaymentReceiptStatus,
  SubscriptionOrderStatus,
} from 'src/domain/enums/subscription';

import { IPaymentReceiptRepository } from 'src/domain/repositories/subscription/IPaymentReceiptRepository';

import { ISubscriptionOrderRepository } from 'src/domain/repositories/subscription/ISubscriptionOrderRepository';

import {
  PAYMENT_RECEIPT_REPOSITORY,
  RECEIPT_ANALYZER,
  SUBSCRIPTION_ORDER_REPOSITORY,
} from '../../domain/repositories/repository.tokens';

import { IReceiptAnalyzer } from 'src/domain/interfaces/receiptAnalyzer.interface';

export interface SubmitPaymentReceiptParams {
  orderId: string;

  /*
   * Local path / CDN URL / object storage URL.
   *
   * Telegram and WhatsApp handlers are responsible
   * for downloading their own media before calling
   * this service.
   */
  imageUrl: string;

  /*
   * Telegram file_id or WhatsApp media id.
   *
   * Optional because the business layer must not
   * depend on a specific communication provider.
   */
  providerFileId?: string;
}

@Injectable()
export class PaymentReceiptService {
  constructor(
    @Inject(PAYMENT_RECEIPT_REPOSITORY)
    private readonly receiptRepository:
      IPaymentReceiptRepository,

    @Inject(SUBSCRIPTION_ORDER_REPOSITORY)
    private readonly orderRepository:
      ISubscriptionOrderRepository,

    @Inject(RECEIPT_ANALYZER)
    private readonly receiptAnalyzer:
      IReceiptAnalyzer,
  ) {}

  async submitReceipt(
    params: SubmitPaymentReceiptParams,
  ): Promise<PaymentReceipt> {
    if (!params.orderId?.trim()) {
      throw new BadRequestException(
        'Order id is required',
      );
    }

    if (!params.imageUrl?.trim()) {
      throw new BadRequestException(
        'Receipt image is required',
      );
    }

    const order =
      await this.orderRepository.findById(
        params.orderId,
      );

    if (!order) {
      throw new NotFoundException(
        'Subscription order not found',
      );
    }

    if (
      order.status ===
        SubscriptionOrderStatus.Approved ||
      order.status ===
        SubscriptionOrderStatus.Rejected ||
      order.status ===
        SubscriptionOrderStatus.Cancelled
    ) {
      throw new BadRequestException(
        'Receipt cannot be submitted for this order',
      );
    }

    const receipt =
      new PaymentReceipt();

    receipt.orderId =
      order.id;

    receipt.imageUrl =
      params.imageUrl;

    receipt.providerFileId =
      params.providerFileId;

    receipt.status =
      PaymentReceiptStatus
        .PendingAnalysis;

    const savedReceipt =
      await this.receiptRepository.save(
        receipt,
      );

    order.status =
      SubscriptionOrderStatus
        .ReceiptSubmitted;

    await this.orderRepository.save(
      order,
    );

    return this.analyzeReceipt(
      savedReceipt.id,
    );
  }

  async analyzeReceipt(
    receiptId: string,
  ): Promise<PaymentReceipt> {
    const receipt =
      await this.receiptRepository.findById(
        receiptId,
      );

    if (!receipt) {
      throw new NotFoundException(
        'Payment receipt not found',
      );
    }

    const order =
      await this.orderRepository.findById(
        receipt.orderId,
      );

    if (!order) {
      throw new NotFoundException(
        'Subscription order not found',
      );
    }

    const result =
      await this.receiptAnalyzer.analyze(
        receipt.imageUrl,
      );

    receipt.extractedAmount =
      result.amount ?? undefined;

    receipt.trackingCode =
      result.trackingCode ?? undefined;

    receipt.transactionDate =
      result.transactionDate ??
      undefined;

    receipt.transactionTime =
      result.transactionTime ??
      undefined;

    receipt.sourceCard =
      result.sourceCard ?? undefined;

    receipt.destinationCard =
      result.destinationCard ??
      undefined;

    receipt.extractedPaymentStatus =
      result.paymentStatus;

    receipt.aiConfidence =
      result.confidence;

    receipt.aiRawResult =
      result.rawResult;

    receipt.amountMatched =
      result.amount === order.amount;

    if (result.trackingCode) {
      receipt.duplicateTrackingCode =
        await this.receiptRepository
          .existsTrackingCode(
            result.trackingCode,
            receipt.id,
          );
    } else {
      receipt.duplicateTrackingCode =
        false;
    }

    receipt.status =
      PaymentReceiptStatus.NeedsReview;

    receipt.analyzedAt =
      new Date();

    order.status =
      SubscriptionOrderStatus
        .UnderReview;

    await this.orderRepository.save(
      order,
    );

    return this.receiptRepository.save(
      receipt,
    );
  }
}