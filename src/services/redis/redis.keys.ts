export const KEY_PREFIXES = {
  registration: 'auth:registration',
  // بعد از تأیید OTP برای شماره‌ای که حساب ندارد: یک‌بارمصرف تا انتخاب نوع حساب
  registrationToken: 'auth:registration-token',
  registrationLock: 'auth:registration-lock',
  registrationCooldown: 'auth:registration-cooldown',
  refreshToken: 'auth:refresh',
  telegramIdentity: 'telegram:identity:v1',
  telegramIdentityRoles: 'telegram:identity-roles:v1',
  telegramAccessLock: 'telegram:onboarding-lock:v1',
  telegramSession: 'telegram:session:v1',
  telegramReceiptLock: 'telegram:receipt-lock:v1',
  telegramKeyboard: 'telegram:keyboard:v1',
  telegramAgentSession: 'telegram:agent-session:v1',
  companyChannelsDialog: 'messenger:channel-flow:v1',
  companyProfileDialog: 'messenger:company-profile:v1',
  cargoSuggestionNoticeActivity: 'messenger:cargo-suggestion-activity:v1',
  // یک اعلان گوشی برای هر موج پیشنهاد بار: پنجره‌ی ارسال و «در این پنجره بار تازه آمد»
  cargoSuggestionPushWindow: 'push:cargo-suggestion-window:v1',
  cargoSuggestionPushPending: 'push:cargo-suggestion-pending:v1',
  cargoDialog: 'messenger:cargo-flow:v1',
  tripDialog: 'messenger:trip-flow:v1',
  locationRequest: 'messenger:location-request:v1',
  whatsappMenu: 'whatsapp:menu:v1',
  whatsappMenuMessages: 'whatsapp:menu-messages:v1',
  whatsappLive: 'whatsapp:live-location:v1',
  // v3: مکان خارجی به هم‌نام داخل ایران نمی‌رسد و کل اسم یکجا کش می‌شود (نتیجه‌های قبلی دور ریخته می‌شوند)
  routingGeocode: 'routing:geocode:v4',
  routingPlace: 'routing:place:v1',
  // داخل ایران بودن مبدأ و مقصد یک مسیر بار (نوع سفر بار)؛ v3: v1 جواب‌های غلط مدل محلی و v2 جواب‌های
  // نشان (هم‌نام ایرانی برای اسم خارجی) را هم نگه داشته بودند
  tripTypeRoute: 'cargo:trip-type-route:v3',
  // v3: مسیر مبدأ/مقصد خارجی با OSRM جهانی (نشان تا مرز حساب می‌کرد)
  routingRoutes: 'routing:routes:v3',
  routingDistance: 'routing:distance:v2',
  routingTraffic: 'routing:traffic:v1',
  // v2: با بنزین؛ همه‌ی تکه‌ها یک بار دوباره دریافت می‌شوند. v1 تا منقضی شدنش برای coverage خوانده می‌شود.
  fuelStationChunk: 'routing:fuel-chunk:v2',
  fuelStationChunkV1: 'routing:fuel-chunk:v1',
  // نوع‌های سوختی که راننده در ربات برای جایگاه‌ها انتخاب کرده
  driverFuelKinds: 'driver:fuel-kinds:v1',
  rubikaPollOffset: 'rubika:poll-offset:v1',
  subscriptionPolicy: 'settings:subscription-policy:v1',
  // مشاهده‌ی عکس رسیدها: توکن کوتاه‌عمر بعد از رمز، و شمارش رمزهای اشتباه هر ادمین
  receiptViewToken: 'admin:receipt-view-token:v1',
  receiptUnlockAttempts: 'admin:receipt-unlock-attempts:v1',
  // هر خبر رسید/نتیجه فقط یک بار فرستاده شود، حتی وقتی چند نمونه‌ی سرور به یک کانال گوش می‌دهند
  subscriptionNoticeSent: 'subscription:notice-sent:v1',
  // v2: همه‌ی قلم‌های قابل انتخاب (MARKET_CATALOG)؛ نسخه‌ی v1 فقط ۶ قلم ثابت را داشت
  marketPrices: 'market:prices:v2',
  marketRefreshLock: 'market:refresh-lock:v2',
  marketLiveMessages: 'market:live-messages:v1',
  // وضعیت مرزها از borderpark.ir (فهرست، و صف/اطلاعیه/تیرپارک هر مرز)
  borderData: 'border:data:v1',
  borderRefreshLock: 'border:refresh-lock:v1',
} as const;

export type RedisKeyParts = {
  registration: [phone: string];
  registrationToken: [token: string];
  registrationLock: [phone: string];
  registrationCooldown: [phone: string];
  refreshToken: [token: string];
  telegramIdentity: [namespace: string, userId: string];
  telegramIdentityRoles: [namespace: string, userId: string];
  telegramAccessLock: [namespace: string, userId: string];
  telegramSession: [namespace: string, userId: string];
  telegramReceiptLock: [namespace: string, userId: string];
  telegramKeyboard: [namespace: string, chatId: string];
  telegramAgentSession: [namespace: string, userId: string];
  companyChannelsDialog: [platform: string, externalUserId: string];
  companyProfileDialog: [platform: string, externalUserId: string];
  cargoSuggestionNoticeActivity: [platform: string, userId: string];
  cargoSuggestionPushWindow: [userId: string];
  cargoSuggestionPushPending: [userId: string];
  cargoDialog: [platform: string, externalUserId: string];
  tripDialog: [platform: string, externalUserId: string];
  locationRequest: [driverUserId: string];
  whatsappMenu: [userId: string];
  whatsappMenuMessages: [userId: string];
  whatsappLive: [userId: string];
  routingGeocode: [place: string];
  routingPlace: [point: string];
  tripTypeRoute: [route: string];
  routingRoutes: [points: string];
  routingDistance: [points: string];
  routingTraffic: [points: string];
  fuelStationChunk: [chunk: string];
  fuelStationChunkV1: [chunk: string];
  driverFuelKinds: [userId: string];
  rubikaPollOffset: [tokenHash: string];
  subscriptionPolicy: [];
  marketPrices: [];
  marketRefreshLock: [];
  marketLiveMessages: [];
  borderData: [kind: string, border: string];
  borderRefreshLock: [];
  receiptViewToken: [token: string];
  receiptUnlockAttempts: [adminUserId: string];
  subscriptionNoticeSent: [event: string, id: string];
};

/** کانال‌های pub/sub بین نمونه‌های برنامه. */
export const REDIS_CHANNELS = {
  /** ادمین سیاست اشتراک را عوض کرده؛ نمونه‌ها کش محلی‌شان را پاک می‌کنند. */
  subscriptionPolicyChanged: 'settings:subscription-policy:changed:v1',
  /** رسید پرداخت تازه (ربات یا برنامه): به ادمین‌ها خبر داده می‌شود تا خریدار معطل نماند. */
  paymentReceiptSubmitted: 'subscription:receipt-submitted:v1',
  /** ادمین رسید را تأیید یا رد کرد: به خریدار در برنامه و واتساپ خبر داده می‌شود. */
  subscriptionDecided: 'subscription:decided:v1',
} as const;

export interface PaymentReceiptSubmittedEvent {
  orderId: string;
  receiptId: string;
}

export interface SubscriptionDecidedEvent {
  orderId: string;
  userId: string;
  approved: boolean;
  accountType: string;
  expireAt?: string;
  reason?: string;
}
