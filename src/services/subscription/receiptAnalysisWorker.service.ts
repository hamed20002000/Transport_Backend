import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IPaymentReceiptRepository } from 'src/domain/repositories/subscription/IPaymentReceiptRepository';
import { PAYMENT_RECEIPT_REPOSITORY } from '../../domain/repositories/repository.tokens';

import { PaymentReceiptService } from './paymentreceipt.service';

/**
 * Database-backed queue for receipt analysis.
 *
 * Receipts are analyzed right after submission; this worker is the
 * safety net for receipts left behind by a crash, a restart or a failed
 * analysis. The PaymentReceipt table is the queue, so nothing is lost if
 * Redis or this process goes down.
 */
@Injectable()
export class ReceiptAnalysisWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ReceiptAnalysisWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(PAYMENT_RECEIPT_REPOSITORY)
    private readonly receiptRepository: IPaymentReceiptRepository,
    private readonly paymentReceiptService: PaymentReceiptService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('RECEIPT_ANALYSIS_WORKER', 'true') === 'false') return;
    const intervalMs = this.positive('RECEIPT_ANALYSIS_INTERVAL_MS', 60_000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One sweep; overlapping sweeps are skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const maxAttempts = this.paymentReceiptService.maxAnalysisAttempts;

      // A claim older than this means its worker died mid-analysis.
      const staleMs = this.positive('RECEIPT_ANALYSIS_STALE_MS', 10 * 60_000);
      const released = await this.receiptRepository.releaseStaleAnalyses(
        new Date(now - staleMs),
        maxAttempts,
      );
      if (released) this.logger.warn(`Released ${released} stale receipt analyses.`);

      // Leave fresh receipts to the immediate trigger after submission.
      const ids = await this.receiptRepository.findPendingAnalysisIds(
        new Date(now - 60_000),
        10,
      );

      // One at a time: the vision model is the bottleneck.
      for (const id of ids) {
        await this.paymentReceiptService.processReceipt(id);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Receipt analysis sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private positive(key: string, fallback: number): number {
    const value = Number(this.config.get(key, fallback));
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }
}
