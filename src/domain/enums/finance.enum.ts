export enum SettlementStatus {
  Pending = 0,
  Calculated = 1,
  PartiallyPaid = 2,
  Paid = 3,
  Cancelled = 4,
  Disputed = 5,
}

export enum PaymentMethod {
  Cash = 0,
  BankTransfer = 1,
  Card = 2,
  Cheque = 3,
  Wallet = 4,
  Other = 5,
}

export enum PaymentStatus {
  Pending = 0,
  Completed = 1,
  Failed = 2,
  Cancelled = 3,
  Refunded = 4,
}