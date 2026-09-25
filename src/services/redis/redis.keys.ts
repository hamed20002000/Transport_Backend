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
} as const;

export type RedisKeyParts = {
  registration: [phone: string];
  registrationLock: [phone: string];
  registrationCooldown: [phone: string];
  refreshToken: [token: string];
  telegramIdentity: [botId: string, userId: string];
  telegramIdentityRoles: [botId: string, userId: string];
  telegramAccessLock: [botId: string, userId: string];
  telegramSession: [botId: string, userId: string];
  telegramReceiptLock: [botId: string, userId: string];
  telegramKeyboard: [botId: string, chatId: string];
};
