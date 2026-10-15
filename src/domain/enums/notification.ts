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
  // شرکت هنگام «برداشته شد» این راننده را انتخاب کرده؛ منتظر تأیید راننده (تا offerExpiresAt)
  Offered = 'OFFERED',
  // شرکت قبول کرد یا راننده بار سپرده‌شده را تأیید کرد: سفر فعال راننده
  Accepted = 'ACCEPTED',
  Rejected = 'REJECTED',
  // راننده بار سپرده‌شده را نپذیرفت
  Declined = 'DECLINED',
  // راننده تا پایان مهلت به بار سپرده‌شده جواب نداد
  Expired = 'EXPIRED',
  Cancelled = 'CANCELLED',
  Delivered = 'DELIVERED',
}

/**
 * نوع بار و راننده: داخلی (داخل ایران)، صادراتی (از ایران به خارج)، وارداتی (از خارج به ایران).
 * بار اعلام‌شده فقط به راننده‌های همان نوع می‌رسد.
 */
export enum CargoTripType {
  Domestic = 'DOMESTIC',
  Export = 'EXPORT',
  Import = 'IMPORT',
}

/** اعلام بار به راننده‌ها: دستی (دکمه‌ی شرکت) یا خودکار هر چند ساعت. */
export enum CargoAnnounceMode {
  Manual = 'MANUAL',
  Auto = 'AUTO',
}
