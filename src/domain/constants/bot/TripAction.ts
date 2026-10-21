/**
 * شناسه‌ی دکمه‌های بخش درخواست/سفر راننده (TripDialog) که جاهای دیگر هم
 * می‌سازند: «پیدا کردن بار»، اعلان بار برای راننده و اعلان‌های سفر.
 */
export const TripAction = {
  Request: 'tr:rq:', // + listingId
  Accept: 'tr:ac:', // + requestId
  Reject: 'tr:rj:', // + requestId
  ActiveTrip: 'tr:dt',
  ShareLocation: 'tr:loc',
  CompanyRequests: 'tr:cr:', // + page
  CompanyTrips: 'tr:ct:', // + page
  // ثبت تحویل بار (راننده یا شرکت)
  Deliver: 'tr:dv:', // + requestId
  // شرکت اعلام تحویل راننده را رد می‌کند («تحویل نشده»)
  RejectDelivery: 'tr:dx:', // + requestId
  Location: 'tr:lr:', // + requestId
  // جزئیات بار برای راننده: مسیرها، سوخت، جایگاه‌ها، بار برگشتی
  Detail: 'tr:cd:', // + listingId
  MyLocation: 'tr:me',
  // صفحه‌هایی که دستیار هم بازشان می‌کند (open_app_section)
  DriverRequests: 'tr:dr:', // + page
  ReturnLoads: 'tr:rt',
  NearStations: 'tr:ns',
  // راننده بار سپرده‌شده را تأیید/رد می‌کند
  OfferYes: 'tr:oy:', // + requestId
  OfferNo: 'tr:on:', // + requestId
} as const;
