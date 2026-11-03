import { BotPlatform } from '../messengerBot/core/botPlatform';

/**
 * One notice reaches a user through one messenger: the first of these it has linked. A send that fails goes on to the
 * next one, so a blocked bot does not swallow the notice. The phone notification of the app (web push) is apart.
 */
export const MESSENGER_ORDER = ['bale', 'eitaa', 'rubika', 'telegram', 'whatsapp'] as const;
export type Messenger = (typeof MESSENGER_ORDER)[number];

interface Link {
  platform: BotPlatform;
  chatId?: string | null;
}

/** The user's bot links in MESSENGER_ORDER, only those that can be sent to now. */
export function orderedLinks<T extends Link>(links: T[], available: (platform: BotPlatform) => boolean): Array<T & { chatId: string }> {
  return MESSENGER_ORDER.flatMap((messenger) => {
    const link = links.find((item) => item.platform === messenger && !!item.chatId && available(item.platform));
    return link ? [link as T & { chatId: string }] : [];
  });
}

/**
 * Sends through the user's first messenger that takes the notice. bot: through a linked bot; whatsapp: false when the
 * user has not linked WhatsApp. A failure is reported and the next messenger is tried. The messenger used, or null.
 */
export async function sendThroughOne<T extends Link>(
  links: T[],
  available: (platform: BotPlatform) => boolean,
  send: { bot: (link: T & { chatId: string }) => Promise<unknown>; whatsapp: () => Promise<boolean> },
  onError: (messenger: Messenger, error: Error) => void,
): Promise<Messenger | null> {
  for (const link of orderedLinks(links, available)) {
    try {
      await send.bot(link);
      return link.platform;
    } catch (error) {
      onError(link.platform, error as Error);
    }
  }
  try {
    if (await send.whatsapp()) return 'whatsapp';
  } catch (error) {
    onError('whatsapp', error as Error);
  }
  return null;
}
