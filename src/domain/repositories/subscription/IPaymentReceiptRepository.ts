import { PaymentReceipt } from '../../entities/subscription/PaymentReceipt';
import { SubscriptionOrder } from '../../entities/subscription/SubscriptionOrder';

export interface IPaymentReceiptRepository {
  findById(
    id: string,
  ): Promise<PaymentReceipt | null>;

  existsTrackingCode(
    trackingCode: string,
    excludeReceiptId?: string,
  ): Promise<boolean>;

  save(
    entity: PaymentReceipt,
  ): Promise<PaymentReceipt>;

  /** Saves the order (new or updated) and its receipt atomically. */
  saveWithOrder(
    receipt: PaymentReceipt,
    order: SubscriptionOrder,
  ): Promise<PaymentReceipt>;

  /**
   * Atomically moves a receipt from PendingAnalysis to Analyzing.
   * Returns false if someone else already claimed it.
   */
  claimForAnalysis(
    receiptId: string,
  ): Promise<boolean>;

  /**
   * Returns a failed analysis to the queue, or to manual review
   * once maxAttempts is reached.
   */
  releaseFailedAnalysis(
    receiptId: string,
    maxAttempts: number,
    error: string,
  ): Promise<void>;

  /** Same as releaseFailedAnalysis, for workers that died mid-analysis. */
  releaseStaleAnalyses(
    startedBefore: Date,
    maxAttempts: number,
  ): Promise<number>;

  findPendingAnalysisIds(
    createdBefore: Date,
    limit: number,
  ): Promise<string[]>;
}
