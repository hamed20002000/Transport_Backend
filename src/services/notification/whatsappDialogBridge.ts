import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { WhatsappService } from 'src/application/services/agent/services/whatsapp.service';
import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { TripAction } from 'src/domain/constants/bot/TripAction';
import { MessengerPlatform } from 'src/domain/enums/messenger';
import { normalizePersianText } from 'src/domain/helper/persianText';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { actionRows, BotAction, BotContext, BotDialogRegistry, BotDocument, BotReply } from '../messengerBot/core/botDialog';
import { hasCards, whatsappCards, whatsappOptionRows, whatsappOptions } from '../messengerBot/core/botCard';
import { matchOptionLabel, parseChoice } from 'src/application/services/agent/services/replyChoice';
import { MarketAction } from '../market/marketBot.service';
import { RedisService } from '../redis/redis.service';

// گزینه‌های آخرین پیام تا این مدت با شماره قابل انتخاب‌اند.
const MENU_TTL_SECONDS = 60 * 60;
// Live Location واتساپ: فقط اولین پیام جواب می‌گیرد، بقیه بی‌صدا ذخیره می‌شوند.
const LIVE_SILENT_SECONDS = 60 * 60;
const MENU_WORDS = ['منو', 'منوی اصلی', 'فهرست', 'menu', '/start', 'start'];
const CANCEL_WORDS = ['لغو', 'انصراف', 'خروج', 'cancel'];
// متن تا این طول زیر عکس (کپشن) می‌رود تا عکس و متن یک پیام باشند، نه دو تا
const CAPTION_LIMIT = 1000;

/** نحوه‌ی فرستادن یک پیام گفتگو در واتساپ. */
interface MenuOptions {
  /** گفتگو منتظر متن هم هست: راهنما «بنویسید، یا شماره بفرستید» */
  waitingForText?: boolean;
  /** خط «۰- 🏠 منوی اصلی» (همه‌جا جز خود منوی اصلی) */
  home?: boolean;
  /** متن زیر راهنما (مثل راهنمای «۰» در منوی اصلی) */
  footer?: string;
  /** عکس پیام (مثل نقشه‌ی مسیر)؛ اگر متن جا شود، کپشن همان عکس می‌شود */
  photo?: { image: Buffer; caption?: string };
}

const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];
const DRIVER_ROLES = ['DRIVER'];

/** بخش‌های منوی واتساپ برای هر نقش: کلید متن در trip.whatsapp.sections → callback منو. */
const SECTIONS: { roles: string[]; key: string; action: string }[] = [
  { roles: DRIVER_ROLES, key: 'findCargo', action: BotCallback.DriverSearchLoads },
  { roles: DRIVER_ROLES, key: 'myRequests', action: BotCallback.DriverLoadRequests },
  { roles: DRIVER_ROLES, key: 'activeTrip', action: BotCallback.DriverActiveTrip },
  { roles: DRIVER_ROLES, key: 'returnLoads', action: BotCallback.DriverReturnLoads },
  { roles: DRIVER_ROLES, key: 'sendLocation', action: TripAction.ShareLocation },
  { roles: DRIVER_ROLES, key: 'myLocation', action: TripAction.MyLocation },
  { roles: DRIVER_ROLES, key: 'nearStations', action: 'tr:ns' },
  { roles: COMPANY_ROLES, key: 'companyLoads', action: BotCallback.CompanyLoads },
  { roles: COMPANY_ROLES, key: 'companyProfile', action: BotCallback.CompanyProfile },
  { roles: COMPANY_ROLES, key: 'createLoad', action: BotCallback.CompanyCreateLoad },
  { roles: COMPANY_ROLES, key: 'driverRequests', action: BotCallback.CompanyDriverRequests },
  { roles: COMPANY_ROLES, key: 'activeTrips', action: BotCallback.CompanyActiveTrips },
  { roles: [...DRIVER_ROLES, ...COMPANY_ROLES], key: 'filters', action: 'cg:fl' },
  { roles: [...DRIVER_ROLES, ...COMPANY_ROLES], key: 'marketPrices', action: MarketAction.Show },
  { roles: DRIVER_ROLES, key: 'borders', action: BotCallback.Borders },
];

interface MenuState {
  actions: string[];
  /** متن گزینه‌ها به همان ترتیب؛ برای جواب صوتی («سفر فعال») و prompt تشخیص گفتار */
  labels?: string[];
  refreshAction?: string;
}

/**
 * گفتگوهای ربات (BotDialogRegistry) در واتساپ: گزینه‌ها لیست شماره‌دار («۱- …») زیر متن‌اند
 * و کاربر با فرستادن شماره انتخاب می‌کند؛ هر کاری (حتی «🏠 نمایش منو») یک گزینه است تا
 * کاربر لازم نباشد دستوری بنویسد. نوشتن «منو» یا اسم یک بخش (مثلاً «سفر فعال») هم کار می‌کند.
 */
@Injectable()
export class WhatsappDialogBridge implements OnModuleInit {
  private readonly logger = new Logger(WhatsappDialogBridge.name);

  constructor(
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsapp: WhatsappService,
    private readonly registry: BotDialogRegistry,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  onModuleInit(): void {
    this.whatsapp.setDialogHandler({
      refreshCargoMenu: (jid, userId) => this.refreshCargoMenu(jid, userId),
      menuLabels: (userId) => this.menuLabels(userId),
      reset: (userId) => this.reset(userId),
      handleVoiceChoice: (jid, userId, text) => this.handleVoiceChoice(jid, userId, text),
      handleText: (jid, userId, text) => this.handleText(jid, userId, text),
      handleLocation: (jid, userId, location) => this.handleLocation(jid, userId, location),
      handleDocument: (jid, userId, document) => this.handleDocument(jid, userId, document),
    });
  }

  //#region ----------- Incoming --------------------------------------------------

  async handleText(jid: string, userId: string, text: string): Promise<boolean> {
    const ctx = this.ctx(userId);
    const value = text.trim();
    const normalized = this.normalize(value);
    const menu = await this.getMenu(userId);

    if (MENU_WORDS.includes(value.toLowerCase())) {
      await this.sendMainMenu(jid, ctx);
      return true;
    }

    // شماره‌ی یکی از گزینه‌های آخرین پیام
    const index = this.number(value);
    if (menu && index !== null && index >= 1 && index <= menu.actions.length) {
      await this.run(jid, ctx, menu.actions[index - 1]);
      return true;
    }

    // مرحله‌ی فرمی که منتظر متن است (ثبت بار، فیلتر، شهر بار برگشتی)
    for (const dialog of this.registry.all()) {
      if (!(await dialog.hasSession(ctx))) continue;
      const reply = await dialog.handleText(ctx, value);
      if (!reply) continue;
      await this.send(jid, ctx, reply);
      return true;
    }

    // اسم یک بخش، مثل «سفر فعال» یا «بار برگشتی»
    const section = (await this.sections(ctx)).find((item) => this.normalize(this.sectionLabel(item.key)) === normalized);
    if (section) {
      await this.run(jid, ctx, section.action);
      return true;
    }

    if (menu && CANCEL_WORDS.includes(value.toLowerCase())) {
      await this.clearMenu(userId);
      await this.sendMenu(jid, userId, this.t('whatsapp.closed'), [], { home: true });
      return true;
    }
    return false;
  }

  /** «/start»: منوی شماره‌دار باز و نشست همه‌ی گفتگوها (فرم، صفحه، انتخاب) پاک می‌شود. */
  async reset(userId: string): Promise<void> {
    await this.clearMenu(userId);
    await this.registry.clearSessions(this.ctx(userId));
  }

  /** گزینه‌های منوی باز (برای prompt تشخیص گفتار)؛ null اگر منویی باز نیست. */
  async menuLabels(userId: string): Promise<string[] | null> {
    const menu = await this.getMenu(userId);
    return menu?.labels?.length ? menu.labels : null;
  }

  /**
   * جواب صوتی به منوی باز: شماره («دو»، «دومی»، «گزینه دو») یا اسم گزینه («سفر فعال»).
   * false اگر گزینه‌ای شناخته نشد.
   */
  async handleVoiceChoice(jid: string, userId: string, text: string): Promise<boolean> {
    const menu = await this.getMenu(userId);
    if (!menu?.actions.length) return false;
    const index = parseChoice(text) ?? (menu.labels ? matchOptionLabel(text, menu.labels) : null);
    if (index === null || index < 1 || index > menu.actions.length) return false;
    await this.run(jid, this.ctx(userId), menu.actions[index - 1]);
    return true;
  }

  async refreshCargoMenu(jid: string, userId: string): Promise<void> {
    const menu = await this.getMenu(userId);
    if (!menu?.refreshAction?.match(/^cg:(mine|sg):/)) return;
    await this.run(jid, this.ctx(userId), menu.refreshAction);
  }

  async handleLocation(
    jid: string,
    userId: string,
    location: { latitude: number; longitude: number; live: boolean },
  ): Promise<boolean> {
    const ctx = this.ctx(userId);
    // به‌روزرسانی‌های بعدی Live Location بی‌صدا
    const edited = location.live
      ? !(await this.redis.setIfAbsent(RedisService.key('whatsappLive', userId), '1', LIVE_SILENT_SECONDS))
      : false;
    for (const dialog of this.registry.all()) {
      const reply = await dialog.handleLocation?.(ctx, {
        latitude: location.latitude,
        longitude: location.longitude,
        edited,
      });
      if (!reply) continue;
      if (!edited) await this.send(jid, ctx, reply);
      return true;
    }
    return false;
  }

  //#endregion

  //#region ----------- Outgoing (notifications) ---------------------------------

  /**
   * اعلان با گزینه (مثل «قبول/رد» درخواست راننده): گزینه‌ها منوی فعلی کاربر
   * می‌شوند تا با فرستادن شماره اجرا شوند. false اگر کاربر واتساپ وصل نکرده.
   */
  async notify(userId: string, text: string, actions: BotAction[] = []): Promise<boolean> {
    const jid = await this.whatsapp.getJidForUsername(userId);
    if (!jid) return false;
    await this.whatsapp.sendNotification(jid, this.render(text, actions, { home: this.options(actions).length > 0 }));
    if (this.options(actions).length) await this.saveMenu(userId, actions);
    return true;
  }

  async sendLocation(userId: string, text: string | null, latitude: number, longitude: number): Promise<boolean> {
    const jid = await this.whatsapp.getJidForUsername(userId);
    if (!jid) return false;
    if (text) await this.whatsapp.sendNotification(jid, text);
    await this.whatsapp.sendLocation(jid, latitude, longitude);
    return true;
  }

  //#endregion

  //#region ----------- Helpers ---------------------------------------------------

  async handleDocument(jid: string, userId: string, document: BotDocument): Promise<boolean> {
    const ctx = this.ctx(userId);
    for (const dialog of this.registry.all()) {
      const reply = await dialog.handleDocument?.(ctx, document);
      if (!reply) continue;
      await this.send(jid, ctx, reply);
      return true;
    }
    return false;
  }

  /** callback منو یا action یکی از گفتگوها را اجرا و جوابش را می‌فرستد. */
  private async run(jid: string, ctx: BotContext, action: string): Promise<void> {
    const resolved = this.registry.resolve(action);
    if (!resolved) {
      await this.sendMainMenu(jid, ctx);
      return;
    }
    // «در حال محاسبه…» پیام جدا نمی‌شود: ⏳ روی پیام خود کاربر (تعداد پیام‌ها کم بماند)
    try {
      const reply = await resolved.dialog.handleAction({ ...ctx, progress: () => this.whatsapp.showProgress(jid) }, resolved.action);
      if (reply) await this.send(jid, ctx, reply);
    } finally {
      await this.whatsapp.clearProgress(jid);
    }
  }

  private async send(jid: string, ctx: BotContext, reply: BotReply): Promise<void> {
    if (reply.closed === 'exit') {
      await this.sendMainMenu(jid, ctx);
      return;
    }
    if (reply.document) {
      const { file, fileName, caption } = reply.document;
      const mimetype = fileName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream';
      await this.whatsapp.sendDocument(jid, file, fileName, mimetype, caption).catch((error: Error) =>
        this.logger.warn(`WhatsApp document failed: ${error.message}`),
      );
    }
    if (reply.voice) {
      await this.whatsapp.sendVoice(jid, reply.voice.audio).catch((error: Error) =>
        this.logger.warn(`WhatsApp voice failed: ${error.message}`),
      );
    }
    // واتساپ دکمه‌ی «ارسال موقعیت» ندارد؛ راهنمای منوی پیوست.
    const text = reply.locationButton ? `${reply.text}\n\n${this.t('whatsapp.locationHint')}` : reply.text;
    // هر پیام گفتگو «۰- 🏠 منوی اصلی» دارد؛ ۰ با شماره‌ی گزینه‌ها و جواب فرم قاطی نمی‌شود
    const waitingForText = await this.waitingForText(ctx);
    await this.sendMenu(jid, ctx.userId, text, reply.actions, { waitingForText, home: true, photo: reply.photo });
    // متن برای کپی (مثل قالب فیلتر) پیام جدا تا با نگه داشتن انگشت فقط همان کپی شود
    if (reply.copyText) await this.whatsapp.sendMenuMessage(jid, ctx.userId, reply.copyText);
    if (this.options(reply.actions).length) await this.saveMenu(ctx.userId, reply.actions, reply.refreshAction);
    else await this.clearMenu(ctx.userId);
  }

  private async waitingForText(ctx: BotContext): Promise<boolean> {
    for (const dialog of this.registry.all()) if (await dialog.hasSession(ctx)) return true;
    return false;
  }

  private async sendMainMenu(jid: string, ctx: BotContext): Promise<void> {
    const sections = await this.sections(ctx);
    if (!sections.length) {
      await this.clearMenu(ctx.userId);
      await this.whatsapp.sendMessage(jid, this.t('whatsapp.noSections'));
      return;
    }
    const actions = sections.map((item) => ({ id: item.action, label: this.sectionLabel(item.key) }));
    // پایین منوی اصلی: «/start» برای شروع دوباره، تا کاربر هیچ‌وقت گیر نکند
    await this.sendMenu(jid, ctx.userId, this.t('whatsapp.menuTitle'), actions, { footer: this.t('whatsapp.startHint') });
    await this.saveMenu(ctx.userId, actions);
  }

  /**
   * متن و گزینه‌ها: گزینه‌ها به شکل نظرسنجی (دکمه‌ی یک‌لمسی)؛ اگر نشد (بیش از ۱۲ گزینه،
   * گزینه‌ی تکراری، خطا) همان فهرست شماره‌دار. شماره فرستادن در هر دو حالت کار می‌کند.
   * متن کوتاه بدون کارت و لینک خودش سؤال نظرسنجی می‌شود تا منو یک پیام باشد (پیام کمتر،
   * خطر بن کمتر)؛ متن بلند جدا و بعد نظرسنجی.
   */
  private async sendMenu(jid: string, userId: string, text: string, actions: BotAction[], options: MenuOptions = {}): Promise<void> {
    const labels = this.options(actions).map((action) => action.label);
    if (!labels.length || !this.whatsapp.canSendMenuPoll(labels)) {
      const rendered = this.render(text, actions, options);
      const message = options.footer ? `${rendered}\n\n${options.footer}` : rendered;
      if (!options.photo) return this.whatsapp.sendMenuMessage(jid, userId, message);
      // عکس و متن یک پیام (کپشن)؛ متن بلند جدا بعد از عکس
      if (message.length <= CAPTION_LIMIT) return this.whatsapp.sendMenuImage(jid, userId, options.photo.image, message);
      await this.sendPhoto(jid, options.photo);
      return this.whatsapp.sendMenuMessage(jid, userId, message);
    }
    if (options.photo) await this.sendPhoto(jid, options.photo);
    const body = this.render(text, actions, { withOptions: false });
    const single = !!body.trim() && !hasCards(text) && !actions.some((action) => action.url) && this.whatsapp.fitsMenuPollQuestion(body);
    if (single && (await this.whatsapp.sendMenuPoll(jid, userId, labels, body))) return;
    if (body.trim()) await this.whatsapp.sendMenuMessage(jid, userId, body);
    if (!(await this.whatsapp.sendMenuPoll(jid, userId, labels))) {
      await this.whatsapp.sendMenuMessage(jid, userId, this.numbered(actions, options));
    }
  }

  private async sendPhoto(jid: string, photo: { image: Buffer; caption?: string }): Promise<void> {
    await this.whatsapp.sendImage(jid, photo.image, photo.caption).catch((error: Error) =>
      this.logger.warn(`WhatsApp image failed: ${error.message}`),
    );
  }

  /** گزینه‌های شماره‌دار؛ دکمه‌های لینک شماره نمی‌گیرند و خط «عنوان: لینک» می‌شوند. */
  private options(actions: BotAction[]): BotAction[] {
    return actions.filter((action) => !action.url);
  }

  /** withOptions=false: گزینه‌ها جدا (نظرسنجی) می‌روند. */
  private render(text: string, actions: BotAction[], options: MenuOptions & { withOptions?: boolean } = {}): string {
    const links = actions.filter((action) => action.url).map((action) => `${action.label}: ${action.url}`);
    const parts = [whatsappCards(text)];
    if (links.length) parts.push(links.join('\n'));
    if (options.withOptions !== false) {
      const numbered = this.numbered(actions, options);
      if (numbered) parts.push(numbered);
    }
    return parts.join('\n\n');
  }

  /** گزینه‌های شماره‌دار، خط «۰- 🏠 منوی اصلی» و راهنما؛ خالی اگر هیچ‌کدام نیست. */
  private numbered(actions: BotAction[], options: MenuOptions = {}): string {
    const lines: string[] = [];
    // همان چیدمان ردیفی ربات‌ها: گزینه‌های یک ردیف در یک خط
    const rows = actionRows(this.options(actions)).map((row) => row.map((action) => action.label));
    if (rows.length) lines.push(whatsappOptionRows(rows));
    if (options.home) lines.push(whatsappOptions([this.t('whatsapp.showMenu')], 0));
    if (!lines.length) return '';
    return [lines.join('\n'), this.t(options.waitingForText ? 'whatsapp.textOrNumberHint' : 'whatsapp.numberHint')].join('\n\n');
  }

  private async sections(ctx: BotContext) {
    const user = await this.users.findById(ctx.userId);
    const roles = user?.userRoles?.map((item) => item.role?.name ?? '') ?? [];
    return SECTIONS.filter((section) => section.roles.some((role) => roles.includes(role)));
  }

  private sectionLabel(key: string): string {
    return this.t(`whatsapp.sections.${key}`);
  }

  private ctx(userId: string): BotContext {
    // userId (uuid) به‌جای jid، چون jid ممکن است ':' داشته باشد که در کلید Redis مجاز نیست.
    return { platform: MessengerPlatform.Whatsapp, externalUserId: userId, userId };
  }

  /** «۳» یا «3» → 3؛ بقیه null */
  private number(value: string): number | null {
    const latin = value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    return /^\d{1,3}$/.test(latin) ? Number(latin) : null;
  }

  /** بدون ایموجی و علامت، برای تطبیق اسم بخش‌ها */
  private normalize(value: string): string {
    return normalizePersianText(value.replace(/[^\p{L}\p{N}\s]/gu, ' ')).replace(/\s+/g, ' ').trim();
  }

  private getMenu(userId: string): Promise<MenuState | null> {
    return this.redis.getJson<MenuState>(RedisService.key('whatsappMenu', userId));
  }

  private saveMenu(userId: string, actions: BotAction[], refreshAction?: string): Promise<void> {
    return this.redis.setJson(
      RedisService.key('whatsappMenu', userId),
      { actions: this.options(actions).map((a) => a.id), labels: this.options(actions).map((a) => a.label), refreshAction },
      MENU_TTL_SECONDS,
    );
  }

  private async clearMenu(userId: string): Promise<void> {
    await this.redis.delete(RedisService.key('whatsappMenu', userId));
  }

  private t(key: string, args?: Record<string, string | number>): string {
    return this.i18n.translate(`trip.${key}`, { lang: 'fa', args }) as string;
  }

  //#endregion
}
