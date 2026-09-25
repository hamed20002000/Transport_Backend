import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { readFile } from 'node:fs/promises';

import {
  IReceiptAnalyzer,
  ReceiptAnalysisResult,
} from '../../domain/interfaces/receiptAnalyzer.interface';

const RECEIPT_PROMPT = `You read Iranian bank card-to-card transfer receipts (Persian or English).
Extract the fields exactly as printed on the image and return JSON only.
- amount: transferred amount in RIALS as digits only (convert Persian digits, remove separators). If the receipt says Toman, multiply by 10.
- trackingCode: the tracking / reference number (شماره پیگیری / کد رهگیری / شماره مرجع), digits or letters only.
- transactionDate: full date with year, month and day, e.g. 1403/05/12.
- transactionTime: time as printed, e.g. 14:32.
- sourceCard: origin card number (کارت مبدا / از کارت).
- destinationCard: destination card number (کارت مقصد / به کارت / شماره کارت گیرنده).
  Card numbers have 16 digits. Copy every digit that is printed. Use * ONLY for the
  positions the receipt itself hides (e.g. 6037-99**-****-1234). Never replace
  printed digits with *. The first 6 and last 4 digits are usually visible.
- destinationName: destination card holder name exactly as printed (به نام / نام دارنده کارت / گیرنده), in Persian.
- paymentStatus: SUCCESS if the transfer succeeded (موفق), FAILED if it failed (ناموفق), otherwise UNKNOWN.
- confidence: 0..1, how sure you are that the image is a real, readable transfer receipt.
Use null for any field that is not visible. Never guess.`;

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    amount: { type: ['string', 'null'] },
    trackingCode: { type: ['string', 'null'] },
    transactionDate: { type: ['string', 'null'] },
    transactionTime: { type: ['string', 'null'] },
    sourceCard: { type: ['string', 'null'] },
    destinationCard: { type: ['string', 'null'] },
    destinationName: { type: ['string', 'null'] },
    paymentStatus: { type: 'string', enum: ['SUCCESS', 'FAILED', 'UNKNOWN'] },
    confidence: { type: 'number' },
  },
  required: [
    'amount',
    'trackingCode',
    'transactionDate',
    'transactionTime',
    'sourceCard',
    'destinationCard',
    'destinationName',
    'paymentStatus',
    'confidence',
  ],
};

/** Reads receipt fields with a vision model served by Ollama. */
@Injectable()
export class ReceiptAnalyzerService
  implements IReceiptAnalyzer
{
  private readonly logger = new Logger(ReceiptAnalyzerService.name);

  constructor(private readonly config: ConfigService) {}

  async analyze(
    imageUrl: string,
  ): Promise<ReceiptAnalysisResult> {
    const model = this.config.get<string>('OLLAMA_VISION_MODEL', 'qwen2.5vl:3b');
    try {
      const response = await axios.post(
        this.config.get<string>('OLLAMA_URL', 'http://localhost:11434/api/chat'),
        {
          model,
          messages: [{
            role: 'user',
            content: RECEIPT_PROMPT,
            images: [await this.loadImage(imageUrl)],
          }],
          format: RECEIPT_SCHEMA,
          stream: false,
          options: { temperature: 0 },
        },
        {
          timeout: Number(this.config.get('OLLAMA_VISION_TIMEOUT_MS', 120000)),
        },
      );

      const content: string = response.data?.message?.content ?? '';
      const parsed = JSON.parse(content) as Record<string, unknown>;

      return {
        amount: this.digits(parsed.amount),
        trackingCode: this.text(parsed.trackingCode, 100)?.replace(/[^0-9A-Za-z]/g, '') || null,
        transactionDate: this.text(parsed.transactionDate, 50),
        transactionTime: this.text(parsed.transactionTime, 20),
        sourceCard: this.card(parsed.sourceCard),
        destinationCard: this.card(parsed.destinationCard),
        destinationName: this.text(parsed.destinationName, 150),
        paymentStatus: ['SUCCESS', 'FAILED'].includes(parsed.paymentStatus as string)
          ? parsed.paymentStatus as 'SUCCESS' | 'FAILED'
          : 'UNKNOWN',
        confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
        rawResult: { analyzer: 'OLLAMA', model, imageUrl, response: parsed },
      };
    } catch (error: unknown) {
      // Rethrown so the analysis queue retries it (Ollama down, bad JSON, ...).
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Receipt analysis failed: ${message}`);
      throw error;
    }
  }

  private async loadImage(imageUrl: string): Promise<string> {
    if (/^https?:\/\//i.test(imageUrl)) {
      const response = await axios.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer' });
      return Buffer.from(response.data).toString('base64');
    }
    return (await readFile(imageUrl)).toString('base64');
  }

  /** Persian/Arabic-Indic digits -> ASCII. */
  private latinDigits(value: string): string {
    return value
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
  }

  private text(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const result = this.latinDigits(String(value)).trim();
    return result ? result.slice(0, maxLength) : null;
  }

  private digits(value: unknown): string | null {
    const result = this.text(value, 100)?.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return result && result.length <= 18 ? result : null;
  }

  /** Keeps digits and masked positions (*) so partial cards can still be compared. */
  private card(value: unknown): string | null {
    const result = this.text(value, 100)
      ?.replace(/[xX×•●]/g, '*')
      .replace(/[^0-9*]/g, '');
    // A fully masked value carries no information; treat it as unread.
    return result && /\d/.test(result) ? result.slice(0, 30) : null;
  }
}
