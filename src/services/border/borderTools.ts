import { Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import { COMPANY_ROLES, textParam, ToolContext, ToolGenerator, ToolParam } from 'src/application/services/agent/tools/toolKit';
import { BorderStatusService } from './borderStatus.service';
import { borderDetailText, borderLine, bordersText } from './borderText';

const BORDER_ROLES = ['DRIVER', ...COMPANY_ROLES];

/**
 * ابزار agent برای وضعیت مرزها (domain border_status): «صف بازرگان چقدره؟»،
 * «وضعیت مرزهای ترکیه»، «مرزها شلوغن؟». متن همان متنی است که ربات نشان می‌دهد.
 */
@Injectable()
export class BorderTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly borders: BorderStatusService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'get_border_status',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'get_border_status', param);
        ctx.requireRole(BORDER_ROLES);

        const wanted = textParam(param.border);
        const matches = wanted ? await self.borders.find(wanted) : [];
        // یک مرز: جزئیات کامل؛ چند مرز (مثلاً یک کشور): یک خط برای هر کدام
        if (matches.length === 1) {
          const detail = await self.borders.detail(matches[0].id);
          if (detail) return ctx.done({ border: detail.border.name, inQueue: String(detail.totals.inQueue) }, borderDetailText(detail));
        }
        const all = await self.borders.details();
        if (matches.length > 1) {
          const ids = new Set(matches.map((border) => border.id));
          const lines = all.filter((detail) => ids.has(detail.border.id)).map((detail) => `• ${borderLine(detail)}`);
          return ctx.done({ count: String(lines.length) }, [`🛃 مرزهای «${wanted}»`, lines.join('\n')].join('\n\n'));
        }
        const notFound = wanted ? `مرزی به اسم «${wanted}» پیدا نشد؛ وضعیت همه‌ی مرزها:\n\n` : '';
        return ctx.done({ count: String(all.length) }, `${notFound}${bordersText(all)}`);
      },
    });
  }
}
