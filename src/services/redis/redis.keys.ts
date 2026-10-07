export const KEY_PREFIXES = {
  registration: 'auth:registration',
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
  cargoDialog: 'messenger:cargo-flow:v1',
  tripDialog: 'messenger:trip-flow:v1',
  locationRequest: 'messenger:location-request:v1',
  whatsappMenu: 'whatsapp:menu:v1',
  whatsappLive: 'whatsapp:live-location:v1',
  routingGeocode: 'routing:geocode:v1',
  routingPlace: 'routing:place:v1',
  routingRoutes: 'routing:routes:v2',
  routingDistance: 'routing:distance:v1',
  routingTraffic: 'routing:traffic:v1',
  fuelStationChunk: 'routing:fuel-chunk:v1',
  rubikaPollOffset: 'rubika:poll-offset:v1',
  subscriptionPolicy: 'settings:subscription-policy:v1',
} as const;

export type RedisKeyParts = {
  registration: [phone: string];
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
  cargoDialog: [platform: string, externalUserId: string];
  tripDialog: [platform: string, externalUserId: string];
  locationRequest: [driverUserId: string];
  whatsappMenu: [userId: string];
  whatsappLive: [userId: string];
  routingGeocode: [place: string];
  routingPlace: [point: string];
  routingRoutes: [points: string];
  routingDistance: [points: string];
  routingTraffic: [points: string];
  fuelStationChunk: [chunk: string];
  rubikaPollOffset: [tokenHash: string];
  subscriptionPolicy: [];
};

/** کانال‌های pub/sub بین نمونه‌های برنامه. */
export const REDIS_CHANNELS = {
  /** ادمین سیاست اشتراک را عوض کرده؛ نمونه‌ها کش محلی‌شان را پاک می‌کنند. */
  subscriptionPolicyChanged: 'settings:subscription-policy:changed:v1',
} as const;
