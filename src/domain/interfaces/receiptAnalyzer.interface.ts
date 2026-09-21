export interface ReceiptAnalysisResult {
  amount: string | null;

  trackingCode: string | null;

  transactionDate: string | null;

  transactionTime: string | null;

  sourceCard: string | null;

  destinationCard: string | null;

  paymentStatus:
    | 'SUCCESS'
    | 'FAILED'
    | 'UNKNOWN';

  confidence: number;

  rawResult: Record<string, unknown>;
}

export interface IReceiptAnalyzer {
  analyze(
    imageUrl: string,
  ): Promise<ReceiptAnalysisResult>;
}