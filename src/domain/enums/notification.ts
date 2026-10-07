export enum NotificationDeliveryStatus {
  Pending = 'PENDING',
  Sent = 'SENT',
  Failed = 'FAILED',
  // کاربر این کانال را وصل نکرده (مثلاً BotLink ندارد).
  Skipped = 'SKIPPED',
}

export enum CargoListingStatus {
  Open = 'OPEN',
  // شرکت (ثبت‌کننده‌ی کانال) اعلام کرده بار فروخته/برداشته شد.
  Taken = 'TAKEN',
}

/** درخواست راننده برای یک بار اعلام‌شده؛ قبول‌شده همان «سفر فعال» است. */
export enum CargoRequestStatus {
  Pending = 'PENDING',
  // شرکت قبول کرد: سفر فعال راننده
  Accepted = 'ACCEPTED',
  Rejected = 'REJECTED',
  Cancelled = 'CANCELLED',
  Delivered = 'DELIVERED',
}
