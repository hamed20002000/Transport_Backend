export enum AccountType {
    Driver = 'DRIVER',
    Company = 'COMPANY',
    Broker = 'BROKER',
}

export enum CommunicationProvider {
    Telegram = 'TELEGRAM',
    Whatsapp = 'WHATSAPP',
    Web = 'WEB',
}

export enum SubscriptionStatus {
    Active = 'ACTIVE',

    Expired = 'EXPIRED',

    Cancelled = 'CANCELLED',
}

export enum SubscriptionOrderStatus {
    WaitingForReceipt = 'WAITING_FOR_RECEIPT',

    ReceiptSubmitted = 'RECEIPT_SUBMITTED',

    UnderReview = 'UNDER_REVIEW',

    Approved = 'APPROVED',

    Rejected = 'REJECTED',

    Cancelled = 'CANCELLED',
}

export enum PaymentReceiptStatus {
    PendingAnalysis = 'PENDING_ANALYSIS',

    /** Claimed by a worker; returns to PendingAnalysis if the worker dies. */
    Analyzing = 'ANALYZING',

    Analyzed = 'ANALYZED',

    NeedsReview = 'NEEDS_REVIEW',

    Approved = 'APPROVED',

    Rejected = 'REJECTED',
}