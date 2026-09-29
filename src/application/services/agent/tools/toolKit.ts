import { HttpException, HttpStatus } from '@nestjs/common';

import { normalizePersianText } from 'src/domain/helper/persianText';
import { ContextManager } from '../contextManager';
import { AgentRequest, RequestResult } from '../types';
import messages from '../localFiles/messages.json';

/** چیزی که ToolRegister به handler می‌دهد: پارامترهای استخراج‌شده + req و sessionId */
export interface ToolParam {
  req: AgentRequest;
  sessionId: string;
  [key: string]: unknown;
}

/** سؤال انتخابی؛ وب، تلگرام و واتس‌اپ آن را به‌صورت گزینه نشان می‌دهند و id را برمی‌گردانند. */
export interface SelectionRequest {
  type: 'selection';
  label: string;
  data: { id: string; title: string }[];
}

export type ToolGenerator = AsyncGenerator<SelectionRequest, RequestResult, unknown>;

export const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];

/**
 * قدم‌های مشترک هر handler (الگوی setash): ثبت خطا/موفقیت در history و
 * برگرداندن RequestResult. شناسه‌ی کاربر همیشه از req (JWT/اتصال پیام‌رسان) است،
 * نه از خروجی مدل.
 */
export class ToolContext {
  constructor(
    private readonly history: ContextManager,
    readonly operation: string,
    readonly param: ToolParam,
  ) {}

  get userId(): string {
    return this.param.req.user.userId;
  }

  /** دسترسی را خود ابزار هم بررسی می‌کند؛ فیلتر domainها فقط برای دقت انتخاب است. */
  requireRole(allowed: string[]): void {
    const roles = this.param.req.user.roles ?? [];
    if (!roles.some((role) => allowed.includes(role))) this.fail(messages.common.notAllowed);
  }

  fail(message: string): never {
    this.history.addNewHistory(
      {
        status: 'fault',
        operation: this.operation,
        parameters: this.history.getParams(this.param),
        result: { errorMessage: message },
      },
      this.param.req.user.username,
      this.param.sessionId,
    );
    throw new HttpException(message, HttpStatus.BAD_REQUEST);
  }

  done(result: Record<string, string>, message: string, continuePrompt?: string): RequestResult {
    this.history.addNewHistory(
      { status: 'success', operation: this.operation, parameters: this.history.getParams(this.param), result },
      this.param.req.user.username,
      this.param.sessionId,
    );
    return { toolName: this.operation, message, continuePrompt };
  }

  /** خطای انگلیسی سرویس‌ها (NotFound، Conflict، ...) به پیام فارسی همین ابزار تبدیل می‌شود. */
  async call<T>(work: Promise<T>, messageOnError: string): Promise<T> {
    try {
      return await work;
    } catch (error) {
      if (error instanceof HttpException) this.fail(messageOnError);
      throw error;
    }
  }
}

//#region Reading parameters -------------------------------------------------

const EMPTY_TEXT = new Set(['', 'null', 'undefined', 'none', '-']);

/** مقدار متنی مدل؛ رشته‌ی خالی یا «null» یعنی گفته نشده. */
export function textParam(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return EMPTY_TEXT.has(trimmed.toLowerCase()) ? undefined : trimmed;
}

/** آرایه‌ی مدل؛ اگر به‌جای آرایه یک رشته با «،» داد هم پذیرفته می‌شود. */
export function listParam(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,،]/) : [];
  return [...new Set(items.map(textParam).filter((item): item is string => item !== undefined))];
}

export function boolParam(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

export const PHONE_PATTERN = /^[0-9۰-۹+\-\s()]{5,20}$/;

//#endregion

//#region Finding the record the user meant ---------------------------------

// کلمه‌هایی که در اشاره به یک مورد می‌آیند ولی آن را از بقیه جدا نمی‌کنند
const NOT_DISTINCTIVE = new Set(
  [
    'بار',
    'بارهای',
    'فیلتر',
    'مسیر',
    'کانال',
    'گروه',
    'لینک',
    'آگهی',
    'به',
    'از',
    'تا',
    'رو',
    'را',
    'و',
    'این',
    'اون',
    'آن',
    'که',
  ].map(normalizePersianText),
);

export function searchTokens(query: string): string[] {
  return normalizePersianText(query)
    .split(/[\s,،\-–—>←→/|]+/)
    .filter((token) => token.length >= 2 && !NOT_DISTINCTIVE.has(token));
}

/** مواردی که بیشترین کلمه‌ی مشترک با توصیف کاربر را دارند (ممکن است چندتا باشند). */
export function findMatches<T>(items: T[], query: string | undefined, textOf: (item: T) => string): T[] {
  const tokens = searchTokens(query ?? '');
  if (!tokens.length) return [];
  const scored = items
    .map((item) => {
      const haystack = normalizePersianText(textOf(item));
      return { item, score: tokens.filter((token) => haystack.includes(token)).length };
    })
    .filter((entry) => entry.score > 0);
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  return scored.filter((entry) => entry.score === best).map((entry) => entry.item);
}

/**
 * موردی که کاربر منظورش بوده: اگر توصیفش دقیقاً به یک مورد خورد همان، وگرنه از
 * خود کاربر می‌پرسد (بین موارد جور یا اگر چیزی جور نشد بین همه). مقدار غلط مدل
 * (مثلاً «moshav» به‌جای «مشهد») این‌طور به سؤال تبدیل می‌شود نه به کار اشتباه.
 */
export async function* pickOne<T>(
  items: T[],
  query: string | undefined,
  view: { id: (item: T) => string; title: (item: T) => string; text: (item: T) => string },
  label: string,
): AsyncGenerator<SelectionRequest, T | undefined, unknown> {
  if (items.length === 0) return undefined;
  if (!textParam(query) && items.length === 1) return items[0];

  const matches = findMatches(items, query, view.text);
  if (matches.length === 1) return matches[0];

  const options = (matches.length ? matches : items).slice(0, 30);
  const answer = yield {
    type: 'selection',
    label,
    data: options.map((item) => ({ id: view.id(item), title: view.title(item) })),
  };
  return options.find((item) => view.id(item) === String(answer));
}

//#endregion

//#region Formatting replies --------------------------------------------------

export const fa = (value: number | string): string => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export interface CargoSummaryFields {
  origin?: string | null;
  destination?: string | null;
  cargoType?: string | null;
  weight?: string | null;
  vehicleType?: string | null;
  price?: string | null;
}

/** «تهران به مشهد · کاشی · ۲۲ تن · تریلی · ۴۵ میلیون» */
export function cargoLine(cargo: CargoSummaryFields | null | undefined): string {
  if (!cargo) return '';
  const route = [cargo.origin, cargo.destination].filter(Boolean).join(' به ');
  return [route, cargo.cargoType, cargo.weight, cargo.vehicleType, cargo.price].filter(Boolean).join(' · ');
}

export const numbered = (lines: string[]): string => lines.map((line, i) => `${fa(i + 1)}. ${line}`).join('\n');

//#endregion

/** «{count} پیشنهاد» با { count: 3 } → «۳ پیشنهاد»؛ عددها فارسی می‌شوند. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) return '';
    return typeof value === 'number' ? fa(value) : value;
  });
}
