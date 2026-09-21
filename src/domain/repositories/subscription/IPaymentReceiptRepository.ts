import { PaymentReceipt } from '../../entities/subscription/PaymentReceipt';

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
}