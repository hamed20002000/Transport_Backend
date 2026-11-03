/**
 * Where a user did something: the installed app (PWA), the site in a browser, a messenger, or the assistant; push is a
 * phone notification of the app, sms a text message. A messenger link carries one of these as its source (?src=).
 */
export const USAGE_CHANNELS = ['pwa', 'web', 'bale', 'eitaa', 'rubika', 'telegram', 'whatsapp', 'agent', 'push', 'sms'] as const;
export type UsageChannel = (typeof USAGE_CHANNELS)[number];

export const isUsageChannel = (value: unknown): value is UsageChannel => (USAGE_CHANNELS as readonly unknown[]).includes(value);

/** The channel of a web request: the installed app or a browser (the X-App-Mode header the panel sends). */
export const webChannel = (mode: unknown): UsageChannel => (mode === 'pwa' ? 'pwa' : 'web');
