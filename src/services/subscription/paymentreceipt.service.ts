import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

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

import {
  CreateSubscriptionOrderParams,
  SubscriptionOrderService,
} from './subscriptionorder.service';

export interface SubmitPaymentReceiptParams {
  /** Existing order waiting for a receipt. */
  orderId?: string;

  /** Order to create together with the receipt, in one transaction. */
  newOrder?: CreateSubscriptionOrderParams;

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

    private readonly config:
      ConfigService,

    private readonly orderService:
      SubscriptionOrderService,
  ) {}

  private readonly logger =
    new Logger(
      PaymentReceiptService.name,
    );

  async submitReceipt(
    params: SubmitPaymentReceiptParams,
  ): Promise<PaymentReceipt> {
    if (
      Boolean(params.orderId?.trim()) ===
      Boolean(params.newOrder)
    ) {
      throw new BadRequestException(
        'Exactly one of order id or new order is required',
      );
    }

    if (!params.imageUrl?.trim()) {
      throw new BadRequestException(
        'Receipt image is required',
      );
    }

    const order =
      params.newOrder
        ? await this.orderService.buildOrder(
          params.newOrder,
        )
        : await this.orderRepository.findById(
          params.orderId!,
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

    order.status =
      SubscriptionOrderStatus
        .ReceiptSubmitted;

    const receipt =
      new PaymentReceipt();

    receipt.imageUrl =
      params.imageUrl;

    receipt.providerFileId =
      params.providerFileId;

    receipt.status =
      PaymentReceiptStatus
        .PendingAnalysis;

    /*
     * Order and receipt are committed together:
     * a paid user never ends up with an order
     * that has no receipt, or the reverse.
     */
    const savedReceipt =
      await this.receiptRepository.saveWithOrder(
        receipt,
        order,
      );

    /*
     * The payment is recorded; the user gets an answer now
     * and the image is read in the background. If this
     * process dies first, ReceiptAnalysisWorker picks the
     * receipt up from the database.
     */
    void this.processReceipt(
      savedReceipt.id,
    );

    return savedReceipt;
  }

  /**
   * Claims and analyzes one receipt. Safe to call concurrently
   * and from several instances: only one caller wins the claim.
   * Never throws; failures go back to the queue.
   */
  async processReceipt(
    receiptId: string,
  ): Promise<void> {
    try {
      if (!(await this.receiptRepository.claimForAnalysis(receiptId))) {
        return;
      }
    } catch (error: unknown) {
      this.logger.error(
        `Could not claim receipt ${receiptId}: ${this.errorMessage(error)}`,
      );

      return;
    }

    try {
      await this.analyzeReceipt(
        receiptId,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Could not analyze receipt ${receiptId}: ${this.errorMessage(error)}`,
      );

      try {
        await this.receiptRepository.releaseFailedAnalysis(
          receiptId,
          this.maxAnalysisAttempts,
          this.errorMessage(error),
        );
      } catch (releaseError: unknown) {
        // The stale-analysis sweep will release it later.
        this.logger.error(
          `Could not release receipt ${receiptId}: ${this.errorMessage(releaseError)}`,
        );
      }
    }
  }

  get maxAnalysisAttempts(): number {
    const value = Number(this.config.get('RECEIPT_ANALYSIS_MAX_ATTEMPTS', 5));
    return Number.isSafeInteger(value) && value > 0 ? value : 5;
  }

  private errorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : String(error);
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

    // Another worker may have taken over after this claim went stale.
    if (receipt.status !== PaymentReceiptStatus.Analyzing) {
      return receipt;
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

    receipt.destinationName =
      result.destinationName ??
      undefined;

    receipt.extractedPaymentStatus =
      result.paymentStatus;

    receipt.aiConfidence =
      result.confidence;

    receipt.aiRawResult =
      result.rawResult;

    // Order amount is stored in the order currency; the analyzer reports rials.
    const expectedRials =
      BigInt(order.amount) *
      (order.currency === 'IRT' ? 10n : 1n);

    receipt.amountMatched =
      result.amount !== null &&
      BigInt(result.amount) === expectedRials;

    receipt.destinationCardMatched =
      this.cardMatches(
        result.destinationCard,
        this.config.getOrThrow<string>('CARD_NO'),
      );

    receipt.destinationNameMatched =
      this.nameMatches(
        result.destinationName,
        this.config.getOrThrow<string>('CARD_OWNER'),
      );

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

    return this.receiptRepository.saveWithOrder(
      receipt,
      order,
    );
  }

  /**
   * Receipts usually mask the middle digits, so only the visible
   * digits are compared; at least the last four must be readable.
   */
  private cardMatches(
    extracted: string | null,
    expected: string,
  ): boolean {
    const card = expected.replace(/\D/g, '');

    if (!extracted || extracted.length !== card.length) {
      return false;
    }

    let visibleDigits = 0;

    for (let i = 0; i < card.length; i++) {
      if (extracted[i] === '*') continue;
      if (extracted[i] !== card[i]) return false;
      visibleDigits++;
    }

    return visibleDigits >= 4 && extracted.slice(-4) === card.slice(-4);
  }

  /**
   * Receipts may print the full name, only the surname, or add a title
   * (آقای/خانم); every word of the shorter name must appear in the other.
   */
  private nameMatches(
    extracted: string | null,
    expected: string,
  ): boolean {
    const words = (value: string) =>
      value
        .replace(/ي/g, 'ی')
        .replace(/ك/g, 'ک')
        .replace(/[‌ً-ٟ]/g, '')
        .replace(/آقای|خانم|جناب/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    if (!extracted) {
      return false;
    }

    const actual = words(extracted);
    const owner = words(expected);

    if (!actual.length || !owner.length) {
      return false;
    }

    const [shorter, longer] =
      actual.length <= owner.length
        ? [actual, owner]
        : [owner, actual];

    return shorter.every(word => longer.includes(word));
  }
}