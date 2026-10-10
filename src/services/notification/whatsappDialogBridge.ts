import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { WhatsappService } from 'src/application/services/agent/services/whatsapp.service';
import { BotCallback } from 'src/domain/constants/bot/BotCallback';
import { TripAction } from 'src/domain/constants/bot/TripAction';
import { MessengerPlatform } from 'src/domain/enums/messenger';
import { normalizePersianText } from 'src/domain/helper/persianText';
import { IUserRepository } from 'src/domain/repositories/IUserRepopsitory';
import { USER_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { BotAction, BotContext, BotDialogRegistry, BotReply } from '../messengerBot/core/botDialog';
import { RedisService } from '../redis/redis.service';

// گزینه‌های آخرین پیام تا این مدت با شماره قابل انتخاب‌اند.
const MENU_TTL_SECONDS = 60 * 60;
// Live Location واتساپ: فقط اولین پیام جواب می‌گیرد، بقیه بی‌صدا ذخیره می‌شوند.
const LIVE_SILENT_SECONDS = 60 * 60;
const MENU_WORDS = ['منو', 'منوی اصلی', 'فهرست', 'menu', '/start', 'start'];
const CANCEL_WORDS = ['لغو', 'انصراف', 'خروج', 'cancel'];

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
  { roles: COMPANY_ROLES, key: 'createLoad', action: BotCallback.CompanyCreateLoad },
  { roles: COMPANY_ROLES, key: 'driverRequests', action: BotCallback.CompanyDriverRequests },
  { roles: COMPANY_ROLES, key: 'activeTrips', action: BotCallback.CompanyActiveTrips },
  { roles: [...DRIVER_ROLES, ...COMPANY_ROLES], key: 'filters', action: 'cg:fl' },
];

interface MenuState {
  actions: string[];
}

/**
 * گفتگوهای ربات (BotDialogRegistry) در واتساپ: گزینه‌ها لیست شماره‌دار زیر متن‌اند
 * و کاربر با فرستادن شماره انتخاب می‌کند. «منو» بخش‌های نقش کاربر را نشان
 * می‌دهد؛ اسم هر بخش (مثلاً «سفر فعال») هم مستقیم بازش می‌کند.
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
      handleText: (jid, userId, text) => this.handleText(jid, userId, text),
      handleLocation: (jid, userId, location) => this.handleLocation(jid, userId, location),
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
      await this.whatsapp.sendMessage(jid, this.t('whatsapp.closed'));
      return true;
    }
    return false;
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
    await this.whatsapp.sendNotification(jid, this.render(text, actions));
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

  /** callback منو یا action یکی از گفتگوها را اجرا و جوابش را می‌فرستد. */
  private async run(jid: string, ctx: BotContext, action: string): Promise<void> {
    const resolved = this.registry.resolve(action);
    if (!resolved) {
      await this.sendMainMenu(jid, ctx);
      return;
    }
    const reply = await resolved.dialog.handleAction(
      { ...ctx, progress: (text) => this.whatsapp.sendMessage(jid, text) },
      resolved.action,
    );
    if (reply) await this.send(jid, ctx, reply);
  }

  private async send(jid: string, ctx: BotContext, reply: BotReply): Promise<void> {
    if (reply.closed === 'exit') {
      await this.sendMainMenu(jid, ctx);
      return;
    }
    if (reply.photo) {
      await this.whatsapp.sendImage(jid, reply.photo.image, reply.photo.caption).catch((error: Error) =>
        this.logger.warn(`WhatsApp image failed: ${error.message}`),
      );
    }
    if (reply.voice) {
      await this.whatsapp.sendVoice(jid, reply.voice.audio).catch((error: Error) =>
        this.logger.warn(`WhatsApp voice failed: ${error.message}`),
      );
    }
    // واتساپ دکمه‌ی «ارسال موقعیت» ندارد؛ راهنمای منوی پیوست.
    const text = reply.locationButton ? `${reply.text}\n\n${this.t('whatsapp.locationHint')}` : reply.text;
    await this.whatsapp.sendMessage(jid, this.render(text, reply.actions));
    if (this.options(reply.actions).length) await this.saveMenu(ctx.userId, reply.actions);
    else await this.clearMenu(ctx.userId);
  }

  private async sendMainMenu(jid: string, ctx: BotContext): Promise<void> {
    const sections = await this.sections(ctx);
    if (!sections.length) {
      await this.clearMenu(ctx.userId);
      await this.whatsapp.sendMessage(jid, this.t('whatsapp.noSections'));
      return;
    }
    const actions = sections.map((item) => ({ id: item.action, label: this.sectionLabel(item.key) }));
    await this.whatsapp.sendMessage(jid, this.render(this.t('whatsapp.menuTitle'), actions));
    await this.saveMenu(ctx.userId, actions);
  }

  /** گزینه‌های شماره‌دار؛ دکمه‌های لینک شماره نمی‌گیرند و خط «عنوان: لینک» می‌شوند. */
  private options(actions: BotAction[]): BotAction[] {
    return actions.filter((action) => !action.url);
  }

  private render(text: string, actions: BotAction[]): string {
    const links = actions.filter((action) => action.url).map((action) => `${action.label}: ${action.url}`);
    const options = this.options(actions).map((action, index) => `${index + 1}. ${action.label}`);
    const parts = [text];
    if (links.length) parts.push(links.join('\n'));
    if (options.length) parts.push(options.join('\n'), this.t('whatsapp.numberHint'));
    return parts.join('\n\n');
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

  private saveMenu(userId: string, actions: BotAction[]): Promise<void> {
    return this.redis.setJson(
      RedisService.key('whatsappMenu', userId),
      { actions: this.options(actions).map((a) => a.id) },
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
