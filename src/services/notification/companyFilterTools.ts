import { Injectable, OnModuleInit } from '@nestjs/common';

import { ContextManager } from 'src/application/services/agent/contextManager';
import messages from 'src/application/services/agent/localFiles/messages.json';
import { ToolRegister } from 'src/application/services/agent/toolRegister';
import {
  boolParam,
  COMPANY_ROLES,
  fa,
  format,
  listParam,
  numbered,
  pickOne,
  textParam,
  ToolContext,
  ToolGenerator,
  ToolParam,
} from 'src/application/services/agent/tools/toolKit';
import { CargoAlertFilter } from 'src/domain/entities/notification/CargoAlertFilter';
import { normalizePersianText } from 'src/domain/helper/persianText';
import { parsePriceToman } from 'src/domain/helper/price';
import { CargoAlertFilterInput, CargoAlertFilterService } from './cargoAlertFilter.service';

const CONDITIONS = ['origins', 'destinations', 'cargoTypes', 'vehicleTypes'] as const;
type Condition = (typeof CONDITIONS)[number];

/**
 * ابزارهای agent برای «تنظیمات نمایش بار» شرکت (domain company_cargo_display_filters).
 */
@Injectable()
export class CompanyFilterTools implements OnModuleInit {
  constructor(
    private readonly toolRegister: ToolRegister,
    private readonly history: ContextManager,
    private readonly filters: CargoAlertFilterService,
  ) {}

  onModuleInit() {
    // handlerها async function* هستند و this ندارند (الگوی setash)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.toolRegister.register({
      functionName: 'list_company_display_filters',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'list_company_display_filters', param);
        ctx.requireRole(COMPANY_ROLES);

        const all = await self.filters.list(ctx.userId);
        if (all.length === 0) return ctx.done({ count: '0' }, messages.filter.none);
        return ctx.done(
          { count: String(all.length) },
          `${format(messages.filter.header, { count: all.length })}\n${numbered(all.map((f) => self.describe(f)))}`,
        );
      },
    });

    this.toolRegister.register({
      functionName: 'create_company_display_filter',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'create_company_display_filter', param);
        ctx.requireRole(COMPANY_ROLES);

        const input: CargoAlertFilterInput = {
          label: textParam(param.title) ?? null,
          origins: listParam(param.origins),
          destinations: listParam(param.destinations),
          cargoTypes: listParam(param.goodsKinds),
          vehicleTypes: listParam(param.truckKinds),
          minPrice: self.price(ctx, param.fareMin),
          maxPrice: self.price(ctx, param.fareMax),
          isActive: true,
        };
        const hasCondition =
          CONDITIONS.some((key) => input[key]?.length) || input.minPrice != null || input.maxPrice != null;
        if (!hasCondition) ctx.fail(messages.filter.needCondition);
        self.checkRange(ctx, input.minPrice, input.maxPrice);

        const created = await ctx.call(self.filters.create(ctx.userId, input), messages.filter.failed);
        return ctx.done({ id: created.id }, format(messages.filter.created, { filter: self.describe(created) }));
      },
    });

    this.toolRegister.register({
      functionName: 'update_company_display_filter',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'update_company_display_filter', param);
        ctx.requireRole(COMPANY_ROLES);

        const additions: Record<Condition, string[]> = {
          origins: listParam(param.addOrigins),
          destinations: listParam(param.addDestinations),
          cargoTypes: listParam(param.addGoodsKinds),
          vehicleTypes: listParam(param.addTruckKinds),
        };
        const drops = new Set(listParam(param.dropValues).map(normalizePersianText));
        const minPrice = self.price(ctx, param.fareFloor);
        const maxPrice = self.price(ctx, param.fareCeiling);
        const nothing =
          CONDITIONS.every((key) => !additions[key].length) && !drops.size && minPrice == null && maxPrice == null;
        if (nothing) ctx.fail(messages.filter.nothingToChange);

        const chosen = yield* self.pick(
          ctx,
          textParam(param.target),
          messages.filter.nothingToEdit,
          messages.filter.pickUpdate,
        );

        // ویرایش افزایشی: مقدار تازه به شرط اضافه و مقدار گفته‌شده از هر شرطی که دارد برداشته می‌شود
        const input: CargoAlertFilterInput = {};
        for (const key of CONDITIONS) {
          const kept = chosen[key].filter((value) => !drops.has(normalizePersianText(value)));
          const next = [...new Set([...kept, ...additions[key]])];
          if (next.length !== chosen[key].length || next.some((value, i) => value !== chosen[key][i]))
            input[key] = next;
        }
        if (minPrice != null) input.minPrice = minPrice;
        if (maxPrice != null) input.maxPrice = maxPrice;
        self.checkRange(ctx, input.minPrice ?? chosen.minPrice, input.maxPrice ?? chosen.maxPrice);

        const updated = await ctx.call(self.filters.update(ctx.userId, chosen.id, input), messages.filter.failed);
        return ctx.done({ id: updated.id }, format(messages.filter.updated, { filter: self.describe(updated) }));
      },
    });

    this.toolRegister.register({
      functionName: 'set_company_display_filter_active',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'set_company_display_filter_active', param);
        ctx.requireRole(COMPANY_ROLES);
        const on = boolParam(param.on);
        if (on === undefined) ctx.fail(messages.filter.activeRequired);

        const chosen = yield* self.pick(
          ctx,
          textParam(param.which),
          messages.filter.nothingToEdit,
          messages.filter.pickActive,
        );
        const updated = await ctx.call(
          self.filters.update(ctx.userId, chosen.id, { isActive: on }),
          messages.filter.failed,
        );
        return ctx.done(
          { id: updated.id, isActive: String(on) },
          format(on ? messages.filter.activated : messages.filter.deactivated, { filter: self.name(updated) }),
        );
      },
    });

    // پیشوند delete_ یعنی FunctionCallService قبل از اجرا از کاربر تأیید می‌گیرد
    this.toolRegister.register({
      functionName: 'delete_company_display_filter',
      handler: async function* (param: ToolParam): ToolGenerator {
        const ctx: ToolContext = new ToolContext(self.history, 'delete_company_display_filter', param);
        ctx.requireRole(COMPANY_ROLES);

        if (boolParam(param.everything)) {
          const all = await self.filters.list(ctx.userId);
          if (all.length === 0) ctx.fail(messages.filter.nothingToDelete);
          for (const filter of all) await ctx.call(self.filters.remove(ctx.userId, filter.id), messages.filter.failed);
          return ctx.done({ deleted: String(all.length) }, format(messages.filter.allDeleted, { count: all.length }));
        }

        const chosen = yield* self.pick(
          ctx,
          textParam(param.which),
          messages.filter.nothingToDelete,
          messages.filter.pickDelete,
        );
        await ctx.call(self.filters.remove(ctx.userId, chosen.id), messages.filter.failed);
        return ctx.done({ id: chosen.id }, format(messages.filter.deleted, { filter: self.name(chosen) }));
      },
    });
  }

  private async *pick(ctx: ToolContext, query: string | undefined, nothing: string, label: string) {
    const all = await this.filters.list(ctx.userId);
    if (all.length === 0) ctx.fail(nothing);
    const chosen = yield* pickOne(
      all,
      query,
      {
        id: (f) => f.id,
        title: (f) => this.describe(f),
        text: (f) => [f.label ?? '', ...f.origins, ...f.destinations, ...f.cargoTypes, ...f.vehicleTypes].join(' '),
      },
      label,
    );
    if (!chosen) ctx.fail(messages.filter.notPicked);
    return chosen;
  }

  /** «۲۰ میلیون» → 20000000؛ مبلغی که گفته شده ولی فهمیده نشد خطاست، نه نادیده گرفتن. */
  private price(ctx: ToolContext, value: unknown): number | null {
    const text = textParam(value);
    if (!text) return null;
    const toman = parsePriceToman(text);
    if (toman === null) ctx.fail(format(messages.filter.badPrice, { price: text }));
    return toman;
  }

  private checkRange(ctx: ToolContext, min: number | null | undefined, max: number | null | undefined) {
    if (min != null && max != null && min > max) ctx.fail(messages.filter.badPriceRange);
  }

  private name(filter: CargoAlertFilter): string {
    return filter.label || this.describe(filter);
  }

  private describe(filter: CargoAlertFilter): string {
    const parts = [
      filter.origins.length ? `مبدأ: ${filter.origins.join('، ')}` : '',
      filter.destinations.length ? `مقصد: ${filter.destinations.join('، ')}` : '',
      filter.cargoTypes.length ? `نوع بار: ${filter.cargoTypes.join('، ')}` : '',
      filter.vehicleTypes.length ? `ماشین: ${filter.vehicleTypes.join('، ')}` : '',
      filter.minPrice != null ? `کرایه از ${fa(filter.minPrice.toLocaleString('en-US'))}` : '',
      filter.maxPrice != null ? `کرایه تا ${fa(filter.maxPrice.toLocaleString('en-US'))}` : '',
    ].filter(Boolean);
    const body = parts.join(' · ') || messages.filter.any;
    const title = filter.label ? `${filter.label}: ${body}` : body;
    return `${title}${filter.isActive ? '' : messages.filter.inactive}`;
  }
}
