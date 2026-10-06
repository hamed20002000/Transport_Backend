import { Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import { COMPANY_ROLES, ToolContext, ToolGenerator, ToolParam } from 'src/application/services/agent/tools/toolKit';
import { SubscriptionStatusService } from './subscriptionStatus.service';

/** کارگزار فعلاً در سامانه نیست؛ ابزار و domain ندارد. */
const ACCOUNT_ROLES = ['DRIVER', ...COMPANY_ROLES];

/**
 * ابزارهای agent برای اشتراک و خرید (domain account_subscription). فقط نتیجه
 * تولید می‌کنند؛ متن را SubscriptionStatusService می‌سازد که دکمه‌های ربات هم
 * از آن استفاده می‌کنند.
 */
@Injectable()
export class SubscriptionTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly status: SubscriptionStatusService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند (الگوی setash)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'get_my_subscription',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'get_my_subscription', param);
        ctx.requireRole(ACCOUNT_ROLES);

        const summary = await self.status.describeSubscription(ctx.userId);
        return ctx.done({ active: String(summary.active) }, summary.text);
      },
    });

    this.toolRegister.register({
      functionName: 'get_payment_status',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'get_payment_status', param);
        ctx.requireRole(ACCOUNT_ROLES);

        const summary = await self.status.describeLatestOrder(ctx.userId);
        return ctx.done({ orderId: summary.orderId ?? '', status: summary.status ?? '' }, summary.text);
      },
    });
  }
}
