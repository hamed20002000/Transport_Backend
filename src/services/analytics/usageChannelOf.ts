import { UsageChannel } from 'src/domain/entities/analytics/usageChannel';
import { MessengerPlatform } from 'src/domain/enums/messenger';
import { BotContext } from '../messengerBot/core/botDialog';
import { parseBotId } from '../messengerBot/core/botPlatform';

/** The messenger a bot or WhatsApp conversation is in (bot users' ids carry theirs: «bale:123»). */
export function messengerOf(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): UsageChannel {
  return ctx.platform === MessengerPlatform.Whatsapp ? 'whatsapp' : parseBotId(ctx.externalUserId).platform;
}
