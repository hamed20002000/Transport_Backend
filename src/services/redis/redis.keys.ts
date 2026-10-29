export const KEY_PREFIXES = {
  registration: 'auth:registration',
  // بعد از تأیید OTP برای شماره‌ای که حساب ندارد: یک‌بارمصرف تا انتخاب نوع حساب
  registrationToken: 'auth:registration-token',
  registrationLock: 'auth:registration-lock',
  registrationCooldown: 'auth:registration-cooldown',
  registrationSends: 'auth:registration-sends',
  refreshToken: 'auth:refresh',
  telegramIdentity: 'telegram:identity:v1',
  telegramIdentityRoles: 'telegram:identity-roles:v1',
  telegramAccessLock: 'telegram:onboarding-lock:v1',
  // a factory invite code sent to a bot, kept until the user's phone number is known
  factoryInvite: 'bot:factory-invite:v1',
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
  factoryDialog: 'messenger:factory-flow:v1',
  companyFeatureDialog: 'messenger:company-feature-flow:v1',
  brokerAccessDialog: 'messenger:broker-access-flow:v1',
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
  // ایتا (GoOmni): رویدادهای پردازش‌شده، کسانی که خودشان اول پیام داده‌اند، و آخرین فهرست گزینه‌ای که هر چت دیده
  eitaaEvent: 'eitaa:event:v1',
  eitaaPeer: 'eitaa:peer:v1',
  eitaaShownKeyboard: 'eitaa:shown-keyboard:v1',
  // کد یک‌بارمصرف اتصال پیام‌رسان (از پنل وب) و تلاش‌های اشتباه هر حساب پیام‌رسان
  messengerLinkCode: 'messenger:link-code:v1',
  messengerLinkUser: 'messenger:link-user:v1',
  messengerLinkAttempts: 'messenger:link-attempts:v1',
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
  registrationSends: [phone: string];
  refreshToken: [token: string];
  telegramIdentity: [namespace: string, userId: string];
  telegramIdentityRoles: [namespace: string, userId: string];
  telegramAccessLock: [namespace: string, userId: string];
  factoryInvite: [namespace: string, userId: string];
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
  factoryDialog: [platform: string, externalUserId: string];
  companyFeatureDialog: [platform: string, externalUserId: string];
  brokerAccessDialog: [platform: string, externalUserId: string];
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
  eitaaEvent: [instanceId: string, eventId: string];
  eitaaPeer: [instanceId: string, peerId: string];
  eitaaShownKeyboard: [namespace: string, chatId: string];
  messengerLinkCode: [platform: string, code: string];
  messengerLinkUser: [platform: string, userId: string];
  messengerLinkAttempts: [externalUserId: string];
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
  /** a company sent a receipt for a menu (CompanyFeatureService): the admins hear of it */
  companyFeatureReceipt: 'company-feature:receipt:v1',
  /** the admin approved or rejected a menu's receipt: the company hears of it everywhere */
  companyFeatureDecided: 'company-feature:decided:v1',
  /** a broker sent a receipt for seeing companies' loads (BrokerAccessService): the admins hear of it */
  brokerAccessReceipt: 'broker-access:receipt:v1',
  /** the admin approved or rejected it: the broker hears of it everywhere */
  brokerAccessDecided: 'broker-access:decided:v1',
  /** a self-signed-up transport company or factory asked to be checked: the parent companies hear of it */
  accountVerificationRequested: 'account-verification:requested:v1',
  /** a parent company approved or rejected it: the account hears of it everywhere */
  accountVerificationDecided: 'account-verification:decided:v1',
  /** نام یا شماره‌ای که روی بارهای اعلام‌شده نوشته می‌شود عوض شد: بارهای قبلی هم مقدار تازه را می‌گیرند. */
  profileContactChanged: 'profile:contact-changed:v1',
} as const;

/** the profile fields a cargo's company name and phones are made of, as they were before the change */
export interface ProfileContactFields {
  profileType?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  domesticCompanyName?: string | null;
  internationalCompanyName?: string | null;
  phone?: string | null;
}

export interface ProfileContactChangedEvent {
  userId: string;
  before: ProfileContactFields;
}

export interface PaymentReceiptSubmittedEvent {
  orderId: string;
  receiptId: string;
}

/** AccountVerificationService → SubscriptionNotifier */
export interface AccountVerificationEvent {
  userId: string;
  name: string;
  /** a decision; absent for a new request */
  approved?: boolean;
  kind?: 'COMPANY' | 'FACTORY' | 'BROKER';
  reason?: string;
  /** requests left after a rejection */
  remaining?: number;
  /** one per announcement, so every instance sends it once and a second request is not taken for the first */
  noticeId?: string;
}

/** CompanyFeatureService → SubscriptionNotifier */
export interface CompanyFeatureOrderEvent {
  orderId: string;
  userId: string;
  feature: string;
  title: string;
  amount: string;
  currency: string;
  /** a decision; absent for a new receipt */
  approved?: boolean;
  expireAt?: string;
  reason?: string;
}

/** BrokerAccessService → SubscriptionNotifier */
export interface BrokerAccessOrderEvent {
  orderId: string;
  userId: string;
  kind: 'NEW' | 'ADD';
  companies: number;
  amount: string;
  currency: string;
  /** a decision; absent for a new receipt */
  approved?: boolean;
  expireAt?: string;
  reason?: string;
}

export interface SubscriptionDecidedEvent {
  orderId: string;
  userId: string;
  approved: boolean;
  accountType: string;
  expireAt?: string;
  reason?: string;
  /** free days the payment earned as a purchase reward (SubscriptionRewardService), and until when */
  bonusDays?: number;
  bonusUntil?: string;
}
