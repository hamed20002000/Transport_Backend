import { BadRequestException, forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { WhatsappService } from 'src/application/services/agent/services/whatsapp.service';
import { PHONE_PATTERN, cargoLine, fa } from 'src/application/services/agent/tools/toolKit';
import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { BotAction, BotContext, BotDialog, BotDialogRegistry, BotDocument, BotReply } from '../messengerBot/core/botDialog';
import { CompanyInviteResult, DriverInviteResult, FactoryInviteBridge, FactoryInviteHandler, FactoryInviteResult } from '../messengerBot/core/factoryInvite';
import { CompanyInviteService } from './companyInvite.service';
import { DriverInviteService } from './driverInvite.service';
import { CargoExcelService, ExcelCargoRow, MAX_EXCEL_BYTES, MAX_EXCEL_ROWS } from '../notification/cargoExcel.service';
import { buildCargoListingText } from '../notification/cargoNotificationText';
import { RedisService } from '../redis/redis.service';
import { FACTORY_ROLE, FactoryCargoInput, FactoryService } from './factory.service';

const PREFIX = 'fy:';
const Action = {
  Create: `${PREFIX}c`,
  Excel: `${PREFIX}x`,
  Loads: `${PREFIX}l`,
  Pick: `${PREFIX}p`,
  Skip: `${PREFIX}s`,
  Cancel: `${PREFIX}q`,
  Confirm: `${PREFIX}ok`,
  ExcelConfirm: `${PREFIX}xok`,
  Close: `${PREFIX}b`,
} as const;

/** مرحله‌های فرم، مثل «ثبت بار» شرکت؛ phone فقط اگر کارخانه شماره‌ای ندارد. */
const STEPS = ['origin', 'destination', 'cargoType', 'weight', 'vehicleType', 'price', 'extraNotes', 'phone'] as const;
type Step = (typeof STEPS)[number];
const REQUIRED: Step[] = ['origin', 'destination', 'phone'];
const MAX_LENGTH: Record<Step, number> = { origin: 200, destination: 200, cargoType: 200, weight: 100, vehicleType: 200, price: 100, extraNotes: 1000, phone: 200 };
const CANCEL_WORDS = ['لغو', 'انصراف', 'cancel'];
const SESSION_TTL_SECONDS = 30 * 60;
const LOADS_PAGE_SIZE = 5;
const EXCEL_SHOWN = 10;

interface FactorySession {
  mode: 'create' | 'excel';
  companyUserId?: string;
  companyName?: string;
  /** create: the step waiting for an answer; null = the preview, waiting for «ارسال» */
  step?: Step | null;
  draft: Partial<Record<Exclude<Step, 'phone'>, string>> & { contactPhones?: string[] };
  /** excel: the checked rows, waiting for «ارسال» */
  rows?: ExcelCargoRow[];
}

/**
 * کارخانه در ربات‌ها و واتساپ: ثبت بار (مرحله‌به‌مرحله) یا با اکسل برای یکی از شرکت‌هایی که دعوتش کرده‌اند، و
 * «بارهای من». همان FactoryService پنل وب؛ بار به «پیشنهادها»ی شرکت می‌رود. دعوت (لینک یا کد) هم از اینجا به
 * ربات‌ها (FactoryInviteBridge) و واتساپ می‌رسد.
 */
@Injectable()
export class FactoryDialog implements BotDialog, FactoryInviteHandler, OnModuleInit {
  private readonly logger = new Logger(FactoryDialog.name);

  readonly entries: Record<string, string> = {
    [BotCallback.FactoryCreateLoad]: Action.Create,
    [BotCallback.FactoryExcel]: Action.Excel,
    [BotCallback.FactoryLoads]: `${Action.Loads}1`,
  };

  constructor(
    private readonly factories: FactoryService,
    private readonly excel: CargoExcelService,
    private readonly registry: BotDialogRegistry,
    private readonly invites: FactoryInviteBridge,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsapp: WhatsappService,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly companyInvites: CompanyInviteService,
    private readonly driverInvites: DriverInviteService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.invites.register(this);
    this.whatsapp.setFactoryInviteHandler(this);
  }

  //#region ----------- Invite (FactoryInviteHandler) -----------------------------

  factoryWelcome(userId: string, token: string): Promise<FactoryInviteResult> {
    return this.factories.welcome(userId, token);
  }

  companyWelcome(userId: string, token: string): Promise<CompanyInviteResult> {
    return this.companyInvites.welcome(userId, token);
  }

  driverWelcome(userId: string, token: string): Promise<DriverInviteResult> {
    return this.driverInvites.welcome(userId, token);
  }

  //#endregion

  ownsAction(id: string): boolean {
    return id.startsWith(PREFIX);
  }

  async hasSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<boolean> {
    return (await this.getSession(ctx)) !== null;
  }

  async clearSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<void> {
    await this.redis.delete(this.sessionKey(ctx));
  }

  async handleAction(ctx: BotContext, id: string): Promise<BotReply | null> {
    if (!this.ownsAction(id)) return null;
    try {
      if (id === Action.Close) {
        await this.clearSession(ctx);
        return { text: '', actions: [], closed: 'exit' };
      }
      const denied = await this.denied(ctx);
      if (denied) return denied;
      if (id === Action.Create) return this.start(ctx, 'create');
      if (id === Action.Excel) return this.start(ctx, 'excel');
      if (id.startsWith(Action.Loads)) return this.loads(ctx, Number(id.slice(Action.Loads.length)) || 1);
      if (id.startsWith(Action.Pick)) return this.pick(ctx, id.slice(Action.Pick.length));
      if (id === Action.Skip) return this.skip(ctx);
      if (id === Action.Cancel) return this.cancel(ctx);
      if (id === Action.Confirm) return this.confirm(ctx);
      if (id === Action.ExcelConfirm) return this.excelConfirm(ctx);
      return this.menu(this.t('failed'));
    } catch (error) {
      this.logger.error(`Factory action ${id} failed for ${ctx.userId}: ${(error as Error).message}`);
      // the server's own Persian reason (e.g. a company that no longer has the factory)
      return this.menu(/[؀-ۿ]/.test((error as Error).message) ? (error as Error).message : this.t('failed'));
    }
  }

  async handleText(ctx: BotContext, text: string): Promise<BotReply | null> {
    const session = await this.getSession(ctx);
    if (!session) return null;
    const value = text.trim();
    if (CANCEL_WORDS.includes(value.toLowerCase())) return this.cancel(ctx);
    // the preview, the company choice and the Excel file wait for a button or a file: other text is not theirs
    if (session.mode !== 'create' || !session.step) return null;

    const step = session.step;
    if (value.length > MAX_LENGTH[step]) return this.askStep(session, this.t('tooLong', { max: fa(MAX_LENGTH[step]) }));
    if (step === 'phone') {
      const phones = value.split(/[,،\s]+/).filter(Boolean);
      const bad = phones.find((phone) => !PHONE_PATTERN.test(phone));
      if (!phones.length || bad || phones.length > 5) return this.askStep(session, this.t('badPhone', { phone: bad ?? value }));
      session.draft.contactPhones = phones;
    } else {
      session.draft[step] = value;
    }
    return this.nextStep(ctx, session);
  }

  async handleDocument(ctx: BotContext, document: BotDocument): Promise<BotReply | null> {
    const session = await this.getSession(ctx);
    if (session?.mode !== 'excel' || !session.companyUserId) return null;
    const retry = this.rows([{ id: Action.Cancel, label: this.t('actions.cancel') }]);
    if (!/\.(xlsx|xls)$/i.test(document.fileName)) return { text: this.t('excel.notExcel'), actions: retry };
    if ((document.size ?? 0) > MAX_EXCEL_BYTES) return { text: this.t('excel.tooBig'), actions: retry };

    let checked: Awaited<ReturnType<FactoryService['checkExcel']>>;
    try {
      const file = await document.download();
      if (file.length > MAX_EXCEL_BYTES) return { text: this.t('excel.tooBig'), actions: retry };
      checked = await this.factories.checkExcel(ctx.userId, session.companyUserId, file);
    } catch (error) {
      if (error instanceof BadRequestException) return { text: `${error.message}\n\n${this.t('excel.sendAgain')}`, actions: retry };
      throw error;
    }
    const { rows, errors } = checked;
    if (errors.length) {
      const lines = errors.slice(0, EXCEL_SHOWN).map((error) => `${this.t('excel.errorRow', { row: fa(error.row) })}${error.column ? ` · ${error.column}` : ''}: ${error.message}`);
      return { text: [this.t('excel.hasErrors'), lines.join('\n'), this.more(errors.length), this.t('excel.sendAgain')].filter(Boolean).join('\n\n'), actions: retry };
    }
    await this.saveSession(ctx, { ...session, rows });
    const lines = rows.slice(0, EXCEL_SHOWN).map((row, i) => `${fa(i + 1)}. ${cargoLine(row.fields)}`);
    return {
      text: [this.t('excel.preview', { count: fa(rows.length), company: session.companyName ?? '' }), lines.join('\n'), this.more(rows.length)].filter(Boolean).join('\n\n'),
      actions: this.rows(
        [{ id: Action.ExcelConfirm, label: this.t('actions.excelConfirm', { count: fa(rows.length) }) }],
        [{ id: Action.Cancel, label: this.t('actions.cancel') }],
      ),
    };
  }

  //#region ----------- Steps ------------------------------------------------------

  /** First the company (skipped when the factory has one), then the form or the Excel file. */
  private async start(ctx: BotContext, mode: FactorySession['mode']): Promise<BotReply> {
    const companies = await this.factories.companies(ctx.userId);
    if (!companies.length) {
      await this.clearSession(ctx);
      return this.menu(this.t('noCompanies'));
    }
    const session: FactorySession = { mode, draft: {} };
    if (companies.length === 1) return this.begin(ctx, { ...session, companyUserId: companies[0].userId, companyName: companies[0].name });
    await this.saveSession(ctx, session);
    return {
      text: this.t('pickCompany'),
      actions: this.rows(...companies.map((company) => [{ id: `${Action.Pick}${company.userId}`, label: `🏢 ${company.name}` }]), [{ id: Action.Cancel, label: this.t('actions.cancel') }]),
    };
  }

  private async pick(ctx: BotContext, companyUserId: string): Promise<BotReply> {
    const session = await this.getSession(ctx);
    const company = (await this.factories.companies(ctx.userId)).find((item) => item.userId === companyUserId);
    if (!session || !company) return this.start(ctx, session?.mode ?? 'create');
    return this.begin(ctx, { ...session, companyUserId: company.userId, companyName: company.name });
  }

  private async begin(ctx: BotContext, session: FactorySession): Promise<BotReply> {
    if (session.mode === 'excel') {
      await this.saveSession(ctx, session);
      return {
        document: { file: this.excel.template(), fileName: 'cargo-template.xlsx' },
        text: this.t('excel.start', { company: session.companyName ?? '', max: fa(MAX_EXCEL_ROWS) }),
        actions: this.rows([{ id: Action.Cancel, label: this.t('actions.cancel') }]),
      };
    }
    session.step = 'origin';
    await this.saveSession(ctx, session);
    return this.askStep(session);
  }

  private async skip(ctx: BotContext): Promise<BotReply> {
    const session = await this.getSession(ctx);
    if (session?.mode !== 'create' || !session.step) return this.menu();
    if (REQUIRED.includes(session.step)) return this.askStep(session);
    return this.nextStep(ctx, session);
  }

  /** The next step; the phone is asked only when the factory's profile has none. */
  private async nextStep(ctx: BotContext, session: FactorySession): Promise<BotReply> {
    const from = session.step ? STEPS.indexOf(session.step) + 1 : STEPS.length;
    let next: Step | null = null;
    for (const step of STEPS.slice(from)) {
      if (step === 'phone' && (session.draft.contactPhones?.length || (await this.defaultPhones(ctx)).length)) continue;
      next = step;
      break;
    }
    session.step = next;
    await this.saveSession(ctx, session);
    return next ? this.askStep(session) : this.preview(ctx, session);
  }

  private askStep(session: FactorySession, problem?: string): BotReply {
    const step = session.step!;
    const actions: BotAction[][] = [];
    if (!REQUIRED.includes(step)) actions.push([{ id: Action.Skip, label: this.t('actions.skip') }]);
    actions.push([{ id: Action.Cancel, label: this.t('actions.cancel') }]);
    return {
      text: [problem, this.t(`ask.${step}`, { company: session.companyName ?? '' })].filter(Boolean).join('\n\n'),
      actions: this.rows(...actions),
    };
  }

  private async preview(ctx: BotContext, session: FactorySession): Promise<BotReply> {
    const input = await this.input(ctx, session);
    const text = buildCargoListingText({ ...input, companyName: null, code: null });
    return {
      text: this.t('preview', { company: session.companyName ?? '', text }),
      actions: this.rows(
        [{ id: Action.Confirm, label: this.t('actions.confirm') }],
        [{ id: Action.Create, label: this.t('actions.restart') }, { id: Action.Cancel, label: this.t('actions.cancel') }],
      ),
    };
  }

  private async confirm(ctx: BotContext): Promise<BotReply> {
    const session = await this.getSession(ctx);
    if (session?.mode !== 'create' || session.step !== null || !session.companyUserId) return this.menu();
    // cleared before sending: a second tap does not send the load twice
    await this.clearSession(ctx);
    await this.factories.send(ctx.userId, session.companyUserId, await this.input(ctx, session));
    return this.done(this.t('sent', { company: session.companyName ?? '' }));
  }

  private async excelConfirm(ctx: BotContext): Promise<BotReply> {
    const session = await this.getSession(ctx);
    if (session?.mode !== 'excel' || !session.rows?.length || !session.companyUserId) return this.menu();
    await this.clearSession(ctx);
    const created = await this.factories.sendRows(ctx.userId, session.companyUserId, session.rows);
    return this.done(this.t('excel.sent', { count: fa(created.length), company: session.companyName ?? '' }));
  }

  private async cancel(ctx: BotContext): Promise<BotReply> {
    await this.clearSession(ctx);
    return this.menu(this.t('cancelled'));
  }

  //#endregion

  private async loads(ctx: BotContext, page: number): Promise<BotReply> {
    const { items, total } = await this.factories.myLoads(ctx.userId, Math.max(1, page), LOADS_PAGE_SIZE);
    if (!total) return this.menu(this.t('loads.empty'));
    const lines = items.map((item, i) =>
      this.t('loads.line', {
        index: fa((page - 1) * LOADS_PAGE_SIZE + i + 1),
        route: `${item.origin} ⬅️ ${item.destination}`,
        company: item.companyName ?? '',
        date: new Date(item.createdAt).toLocaleDateString('fa-IR'),
      }),
    );
    const pages = Math.ceil(total / LOADS_PAGE_SIZE);
    const pager: BotAction[] = [];
    if (page > 1) pager.push({ id: `${Action.Loads}${page - 1}`, label: this.t('actions.previous') });
    if (page < pages) pager.push({ id: `${Action.Loads}${page + 1}`, label: this.t('actions.next') });
    return {
      text: [this.t('loads.title', { total: fa(total) }), lines.join('\n')].join('\n\n'),
      actions: this.rows(pager, [{ id: Action.Create, label: this.t('actions.create') }], [{ id: Action.Close, label: this.t('actions.back') }]),
    };
  }

  //#region ----------- Helpers ----------------------------------------------------

  private async input(ctx: BotContext, session: FactorySession): Promise<FactoryCargoInput> {
    const { draft } = session;
    return {
      origin: draft.origin ?? '',
      destination: draft.destination ?? '',
      cargoType: draft.cargoType ?? null,
      weight: draft.weight ?? null,
      vehicleType: draft.vehicleType ?? null,
      price: draft.price ?? null,
      extraNotes: draft.extraNotes ?? null,
      contactPhones: draft.contactPhones?.length ? draft.contactPhones : await this.defaultPhones(ctx),
    };
  }

  private async defaultPhones(ctx: BotContext): Promise<string[]> {
    return (await this.factories.draft(ctx.userId)).contactPhones;
  }

  private async denied(ctx: BotContext): Promise<BotReply | null> {
    const user = await this.users.findById(ctx.userId);
    if (user?.userRoles?.some((item) => item.role?.name === FACTORY_ROLE)) return null;
    await this.clearSession(ctx);
    return { text: this.t('onlyFactory'), actions: [], closed: 'denied' };
  }

  /** The main factory actions under a message (after sending, cancelling, an empty list). */
  private menu(text = ''): BotReply {
    return {
      text: text || this.t('failed'),
      actions: this.rows(
        [{ id: Action.Create, label: this.t('actions.create') }, { id: Action.Excel, label: this.t('actions.excel') }],
        [{ id: `${Action.Loads}1`, label: this.t('actions.loads') }],
        [{ id: Action.Close, label: this.t('actions.back') }],
      ),
    };
  }

  private done(text: string): BotReply {
    return this.menu(text);
  }

  /** Each array is one row of buttons (WhatsApp lists them one per line). */
  private rows(...rows: BotAction[][]): BotAction[] {
    return rows.filter((row) => row.length).flatMap((row, index) => row.map((action) => ({ ...action, row: index })));
  }

  private more(total: number): string {
    return total > EXCEL_SHOWN ? this.t('excel.more', { count: fa(total - EXCEL_SHOWN) }) : '';
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`factory.${key}`, { lang: 'fa', args }) as string;
  }

  private sessionKey(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): string {
    return RedisService.key('factoryDialog', ctx.platform, ctx.externalUserId);
  }

  private getSession(ctx: Pick<BotContext, 'platform' | 'externalUserId'>): Promise<FactorySession | null> {
    return this.redis.getJson<FactorySession>(this.sessionKey(ctx));
  }

  private saveSession(ctx: BotContext, session: FactorySession): Promise<void> {
    return this.redis.setJson(this.sessionKey(ctx), session, SESSION_TTL_SECONDS);
  }

  //#endregion
}
