import { Injectable } from '@nestjs/common';

import {
  IReceiptAnalyzer,
  ReceiptAnalysisResult,
} from '../../domain/interfaces/receiptAnalyzer.interface';

@Injectable()
export class ReceiptAnalyzerService
  implements IReceiptAnalyzer
{
  async analyze(
    imageUrl: string,
  ): Promise<ReceiptAnalysisResult> {
    return {
      amount: null,
      trackingCode: null,
      transactionDate: null,
      transactionTime: null,
      sourceCard: null,
      destinationCard: null,
      paymentStatus: 'UNKNOWN',
      confidence: 0,
      rawResult: {
        analyzer: 'NOT_CONFIGURED',
        imageUrl,
      },
    };
  }
}