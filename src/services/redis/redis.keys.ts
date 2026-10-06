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
  rubikaPollOffset: 'rubika:poll-offset:v1',
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
  rubikaPollOffset: [tokenHash: string];
};
