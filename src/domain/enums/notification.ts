export enum NotificationDeliveryStatus {
  Pending = 'PENDING',
  Sent = 'SENT',
  Failed = 'FAILED',
  // کاربر این کانال را وصل نکرده (مثلاً TelegramLink ندارد).
  Skipped = 'SKIPPED',
}

export enum CargoListingStatus {
  Open = 'OPEN',
  // شرکت (ثبت‌کننده‌ی کانال) اعلام کرده بار فروخته/برداشته شد.
  Taken = 'TAKEN',
}
