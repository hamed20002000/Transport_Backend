import { Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import messages from 'src/application/services/agent/localFiles/messages.json';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import {
  COMPANY_ROLES,
  format,
  numbered,
  pickOne,
  textParam,
  ToolContext,
  ToolGenerator,
  ToolParam,
} from 'src/application/services/agent/tools/toolKit';
import { ChannelSubscriptionService, UserChannel } from './channelSubscription.service';
import { ChannelServiceError } from './tarabariChannels.client';

// بررسی دقیق هر پلتفرم در tarabari_backend (channelRegistry) انجام می‌شود.
const INVITE_LINK = /^https:\/\/(www\.)?(t\.me|telegram\.me|chat\.whatsapp\.com|whatsapp\.com\/channel|ble\.ir|rubika\.ir)\/\S+$/i;

const PLATFORM_NAMES: Record<string, string> = {
  whatsapp: 'واتس‌اپ',
  telegram: 'تلگرام',
  bale: 'بله',
  rubika: 'روبیکا',
};

/**
 * ابزارهای agent برای «گروه‌ها و کانال‌ها»ی شرکت (domain company_channels).
 * همان ChannelSubscriptionService که وب، تلگرام و واتس‌اپ استفاده می‌کنند.
 */
@Injectable()
export class CompanyChannelTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly channels: ChannelSubscriptionService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند (الگوی setash)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'list_company_channels',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'list_company_channels', param);
        await self.checkAccess(ctx);

        const all = await ctx.call(self.channels.list(ctx.userId), messages.channel.serviceDown);
        if (all.length === 0) return ctx.done({ count: '0' }, messages.channel.none);
        const lines = all.map((channel) => `${self.name(channel)} — ${self.status(channel)}`);
        return ctx.done(
          { count: String(all.length) },
          `${format(messages.channel.header, { count: all.length })}\n${numbered(lines)}`,
        );
      },
    });

    this.toolRegister.register({
      functionName: 'add_company_channel',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'add_company_channel', param);
        await self.checkAccess(ctx);

        const link = textParam(param.link);
        if (!link) ctx.fail(messages.channel.linkRequired);
        if (!INVITE_LINK.test(link)) ctx.fail(messages.channel.badLink);

        try {
          const result = await self.channels.add(ctx.userId, link, textParam(param.title));
          return ctx.done(
            { id: result.channel.id, created: String(result.created) },
            result.created ? messages.channel.added : messages.channel.alreadyAdded,
          );
        } catch (error) {
          if (error instanceof ChannelServiceError) {
            ctx.fail(error.kind === 'invalid' ? messages.channel.badLink : messages.channel.serviceDown);
          }
          throw error;
        }
      },
    });

    // پیشوند delete_ یعنی FunctionCallService قبل از اجرا از کاربر تأیید می‌گیرد
    this.toolRegister.register({
      functionName: 'delete_company_channel',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'delete_company_channel', param);
        await self.checkAccess(ctx);

        const all = await ctx.call(self.channels.list(ctx.userId), messages.channel.serviceDown);
        if (all.length === 0) ctx.fail(messages.channel.nothingToDelete);

        const chosen = yield* pickOne(
          all,
          textParam(param.channel),
          {
            id: (channel) => channel.id,
            title: (channel) => self.name(channel),
            text: (channel) => `${channel.label ?? ''} ${channel.identifier ?? ''}`,
          },
          messages.channel.pickDelete,
        );
        if (!chosen) ctx.fail(messages.channel.notPicked);

        try {
          await self.channels.remove(ctx.userId, chosen.platform, chosen.id);
        } catch (error) {
          if (error instanceof ChannelServiceError) {
            ctx.fail(error.kind === 'notFound' ? messages.channel.deleteFailed : messages.channel.serviceDown);
          }
          throw error;
        }
        return ctx.done({ id: chosen.id }, format(messages.channel.deleted, { name: self.name(chosen) }));
      },
    });
  }

  /** همان قانون وب و ربات‌ها: فقط شرکت با اشتراک فعال. */
  private async checkAccess(ctx: ToolContext): Promise<void> {
    ctx.requireRole(COMPANY_ROLES);
    const access = await this.channels.checkAccess(ctx.userId);
    if (access === 'notCompany') ctx.fail(messages.channel.notCompany);
    if (access === 'noSubscription') ctx.fail(messages.channel.noSubscription);
  }

  private name(channel: UserChannel): string {
    const platform = PLATFORM_NAMES[channel.platform] ?? channel.platform;
    return `${channel.label || channel.identifier || 'بدون نام'} (${platform})`;
  }

  /** همان ترتیب ChannelLinks.tsx در فرانت، تا agent و صفحه یک چیز بگویند. */
  private status(channel: UserChannel): string {
    const membership = (channel as UserChannel & { membershipStatus?: string }).membershipStatus;
    if (membership === 'failed') return messages.channel.statusMemberFailed;
    if (membership === 'removed') return messages.channel.statusRemoved;
    if (!channel.isActive) return messages.channel.statusInactive;
    if (channel.isMember) return messages.channel.statusActive;
    if (channel.lastError) return messages.channel.statusFailed;
    if (channel.joinRequestPending) return messages.channel.statusPending;
    return messages.channel.statusQueued;
  }
}
