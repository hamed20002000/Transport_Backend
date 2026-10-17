import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { CargoDetectedEvent } from '../../domain/constants/cargoEvents';
import { CargoListing } from '../../domain/entities/notification/CargoListing';
import { CargoNotification } from '../../domain/entities/notification/CargoNotification';
import { CargoListingStatus, NotificationDeliveryStatus } from '../../domain/enums/notification';
import { SUBSCRIPTION_REPOSITORY, BOT_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { ISubscriptionRepository } from '../../domain/repositories/subscription/ISubscriptionRepository';
import { SubscriptionPolicyService } from '../subscription/subscriptionPolicy.service';
import { CargoListingRepository } from '../../infrastructure/repositories/notification/cargoListing.repository';
import { CargoAudienceRepository } from '../../infrastructure/repositories/notification/cargoAudience.repository';
import {
  CargoNotificationDelivery,
  CargoNotificationKind,
  CargoNotificationRepository,
} from '../../infrastructure/repositories/notification/cargoNotification.repository';
import { IBotLinkRepository } from '../../domain/repositories/messengerBot/IBotLinkRepository';
import { WhatsappService } from '../../application/services/agent/services/whatsapp.service';
import { MessengerBotService } from '../messengerBot/core/messengerBot.service';
import { CargoAlertFilterService, CargoRouteFields } from './cargoAlertFilter.service';
import { BOT_DELIVERY_COLUMNS, isPermanentTelegramError, nextDeliveryRetryAt } from './cargoDeliveryRetry';
import { BOT_PLATFORMS, BotPlatform } from '../messengerBot/core/botPlatform';
import { buildCargoNotificationText, buildCargoSuggestionNotice, cargoTextWithCard } from './cargoNotificationText';
import { whatsappCards } from '../messengerBot/core/botCard';
import { CargoVoiceService } from './cargoVoice.service';
import { DriverProfileService } from '../driver/driverProfile.service';
import { CargoSearch, matchesCargoSearch, prepareCargoSearch } from './cargoSearch';
import { CARGO_NOTIFICATION_SOCKET_EVENT, NotificationsGateway } from './notifications.gateway';
import { TripAction } from '../../domain/constants/bot/TripAction';

const BOT_PLATFORM_LABEL_EN: Record<BotPlatform, string> = { telegram: 'Telegram', bale: 'Bale', rubika: 'Rubika' };

// سقف ردیف‌هایی که برای غربال با فیلترها خوانده می‌شوند (جدیدترین‌ها).
const LIST_SCAN_LIMIT = 1000;

// CargoSearch: جستجوی لحظه‌ای agent (مبدأ، مقصد، نوع بار، ماشین)
interface SuggestionListOptions extends CargoSearch {
  unreadOnly: boolean;
  kind?: CargoNotificationKind;
  page: number;
  pageSize: number;
}

const REQUEST_BUTTON = '🙋 درخواست این بار';
const DETAIL_BUTTON = '🗺 مسیر و جزئیات';

// پیشنهاد بار در پیام‌رسان‌ها فقط با یک اعلان کوتاه خبر داده می‌شود و کاربر
// جزئیات را در «بارهای پیشنهادی» می‌بیند. دکمه‌ی ربات‌ها لیست خوانده‌نشده‌ها
// را در CargoDialog باز می‌کند؛ واتساپ دکمه ندارد و اسم بخش منو را می‌فرستد.
const SUGGESTIONS_BUTTON = '📥 بارهای پیشنهادی';
const SUGGESTIONS_UNREAD_ACTION = 'cg:sg:u:1';
const WHATSAPP_SUGGESTIONS_HINT = 'برای دیدن جزئیات، «بارهای شرکت» را بفرستید.';
// چند بار پشت‌سرهم (مثلاً از چند کانال) نباید چند اعلان یکسان بفرستد --
// مزاحم کاربر است و در واتساپ پیام تکراری پشت‌سرهم الگوی اسپم و ریسک بن است.
// در این فاصله فقط یک اعلان (با تعداد خوانده‌نشده‌ها) برای هر پیام‌رسان می‌رود.
const SUGGESTION_NOTICE_COOLDOWN_MS = Number(process.env.CARGO_SUGGESTION_NOTICE_COOLDOWN_MS) || 5 * 60 * 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ارسال اعلان بار در سه کانال (وب، تلگرام، واتساپ) و لیست اعلان‌های هر کاربر.
 *
 * دو نوع اعلان داریم:
 *  - پیشنهاد به شرکت: باری در کانالی که شرکت ثبت کرده دیده شد (handleCargoDetected).
 *  - بار منتشرشده برای راننده: شرکت آن را به نام خودش فرستاده (CargoListingService).
 */
@Injectable()
export class CargoNotificationService {
  private readonly logger = new Logger(CargoNotificationService.name);

  // زمان آخرین اعلان پیشنهاد بار برای هر «پیام‌رسان:کاربر».
  private readonly lastSuggestionNoticeAt = new Map<string, number>();

  constructor(
    private readonly notifications: CargoNotificationRepository,
    private readonly listings: CargoListingRepository,
    private readonly filters: CargoAlertFilterService,
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: ISubscriptionRepository,
    @Inject(BOT_LINK_REPOSITORY)
    private readonly botLinks: IBotLinkRepository,
    private readonly bots: MessengerBotService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsapp: WhatsappService,
    private readonly gateway: NotificationsGateway,
    private readonly policy: SubscriptionPolicyService,
    private readonly voice: CargoVoiceService,
    private readonly profiles: DriverProfileService,
    private readonly audience: CargoAudienceRepository,
  ) {}

  /**
   * پیشنهاد بار به شرکت‌ها. هنوز چیزی در CargoListing ثبت نمی‌شود؛ فقط اگر
   * شرکتی بار را بخواهد و منتشر کند.
   *
   * ۱. گیرنده‌ها: ثبت‌کننده‌های کانال که اشتراک فعال دارند و فیلترشان match می‌شود
   * ۲. ثبت اعلان (تکراری‌ها نادیده گرفته می‌شوند)
   * ۳. ارسال به وب (فقط اعلان‌های تازه) و تلگرام/واتساپ (هر کانالی که هنوز Pending است)
   *
   * خطای دیتابیس بالا می‌رود تا پیام nack شود؛ خطای ارسال فقط در وضعیت همان
   * کانال ثبت می‌شود و بقیه را متوقف نمی‌کند.
   */
  async handleCargoDetected(event: CargoDetectedEvent): Promise<void> {
    const { owners, companies, subscribed, recipients } = await this.resolveRecipients(event);
    if (recipients.length === 0) {
      // مشخص می‌کند کاربرها در کدام مرحله حذف شدند.
      this.logger.log(
        `No recipients for cargo message ${event.messageId}: ` +
          `${owners.length} channel owner(s), ${companies.length} company account(s), ${subscribed.length} with an active subscription, 0 matching filters`,
      );
      return;
    }

    const text = buildCargoNotificationText(event);
    const createdIds = await this.notifications.insertIgnoringDuplicates(
      recipients.map((userId) => ({
        userId,
        sourceMessageId: event.messageId,
        text,
        payload: event as Record<string, unknown>,
      })),
    );

    const rows = await this.notifications.findSuggestions(event.messageId, recipients);
    for (const row of rows) {
      if (createdIds.has(row.id)) {
        this.gateway.sendToUser(row.userId, CARGO_NOTIFICATION_SOCKET_EVENT, this.toView(row));
      }
      await this.deliver(row);
    }

    this.logger.log(
      `Cargo message ${event.messageId}: ${createdIds.size} new suggestion(s) for ${recipients.length} company user(s)`,
    );
  }

  private async resolveRecipients(event: CargoDetectedEvent) {
    const owners = [...new Set(event.ownerUserIds.filter((id) => UUID_PATTERN.test(id)))];
    // پیشنهاد بار کانال‌ها مال شرکت است؛ صاحب کانالی که نقشش راننده شده دیگر نمی‌گیرد
    const companies = await this.audience.filterCompanyUserIds(owners);

    const required = await this.policy.isRequired();
    const subscribed: string[] = [];
    for (const userId of companies) {
      if (!required || await this.subscriptions.findActiveByUserId(userId)) subscribed.push(userId);
    }

    const recipients = await this.filters.filterInterestedUsers(subscribed, event);
    return { owners, companies, subscribed, recipients };
  }

  /*
   * =====================================================
   * Delivery (Telegram / WhatsApp)
   * =====================================================
   */

  /** ارسال کانال‌هایی که هنوز Pending هستند. بار برداشته‌شده دیگر ارسال نمی‌شود. */
  async deliver(row: CargoNotification): Promise<void> {
    const isOpen = row.listing?.status !== CargoListingStatus.Taken;
    // هر پیام‌رسانی که کاربر وصل کرده جدا ارسال می‌شود؛ فیلتر بودن یکی جلوی بقیه را نمی‌گیرد.
    for (const platform of BOT_PLATFORMS) await this.deliverBot(platform, row, isOpen);
    await this.deliverWhatsapp(row, isOpen);
  }

  /** تلاش مجدد کانال‌هایی که زمانشان رسیده (صدا زده شده از CargoDeliveryRetryWorker). */
  async retryDelivery(row: CargoNotification, now = new Date()): Promise<void> {
    const isOpen = row.listing?.status !== CargoListingStatus.Taken;
    const due = (nextRetryAt?: Date | null) => !!nextRetryAt && nextRetryAt.getTime() <= now.getTime();

    for (const platform of BOT_PLATFORMS) {
      if (due(row[BOT_DELIVERY_COLUMNS[platform].nextRetryAt])) await this.deliverBot(platform, row, isOpen);
    }
    if (due(row.whatsappNextRetryAt)) await this.deliverWhatsapp(row, isOpen);
  }

  /** ارسال با ربات تلگرام، بله یا روبیکا (همه از MessengerBotService / MultiBot). */
  private async deliverBot(platform: BotPlatform, row: CargoNotification, isOpen: boolean): Promise<void> {
    const columns = BOT_DELIVERY_COLUMNS[platform];
    if (row[columns.status] !== NotificationDeliveryStatus.Pending) return;

    const update = (changes: Record<string, unknown>) =>
      this.notifications.updateDelivery(row.id, changes as CargoNotificationDelivery);

    const link = isOpen && this.bots.hasPlatform(platform)
      ? await this.botLinks.findByUserId(row.userId, platform)
      : null;
    if (!link?.chatId || (!row.listingId && this.inSuggestionNoticeCooldown(platform, row.userId))) {
      await update({ [columns.status]: NotificationDeliveryStatus.Skipped, [columns.nextRetryAt]: null });
      return;
    }

    const attempts = row[columns.attempts] + 1;
    try {
      // بار اعلام‌شده برای راننده: دکمه‌ی «درخواست این بار»؛ با «برداشته شد»
      // پیام ویرایش و دکمه برداشته می‌شود. پیشنهاد بار: فقط اعلان کوتاه.
      const messageId = row.listingId
        ? await this.bots.sendActionNotification(link.chatId, cargoTextWithCard(row.text), [
            { id: `${TripAction.Detail}${row.listingId}`, label: DETAIL_BUTTON, row: 0 },
            { id: `${TripAction.Request}${row.listingId}`, label: REQUEST_BUTTON, row: 0 },
          ])
        : await this.bots.sendActionNotification(link.chatId, await this.suggestionNoticeText(row.userId), [
            { id: SUGGESTIONS_UNREAD_ACTION, label: SUGGESTIONS_BUTTON, row: 0 },
          ]);
      if (!row.listingId) this.markSuggestionNoticeSent(platform, row.userId);
      await update({
        [columns.status]: NotificationDeliveryStatus.Sent,
        [columns.chatId]: link.chatId,
        // تلگرام ستون integer دارد؛ شناسه‌ی پیام روبیکا عدد نیست.
        [columns.messageId]: platform === 'telegram' ? messageId : String(messageId),
        [columns.attempts]: attempts,
        [columns.nextRetryAt]: null,
      });
    } catch (error) {
      const retryAt = isPermanentTelegramError(error) ? null : nextDeliveryRetryAt(attempts, row.createdAt);
      this.logFailure(BOT_PLATFORM_LABEL_EN[platform], row, attempts, retryAt, error);
      await update({
        [columns.status]: retryAt ? NotificationDeliveryStatus.Pending : NotificationDeliveryStatus.Failed,
        [columns.attempts]: attempts,
        [columns.nextRetryAt]: retryAt,
      });
      return;
    }
    const chatId = link.chatId;
    await this.sendListingVoice(row, (audio) => this.bots.sendVoiceNotification(chatId, audio));
  }

  private async deliverWhatsapp(row: CargoNotification, isOpen: boolean): Promise<void> {
    if (row.whatsappStatus !== NotificationDeliveryStatus.Pending) return;

    const jid = isOpen ? await this.whatsapp.getJidForUsername(row.userId) : null;
    if (!jid || (!row.listingId && this.inSuggestionNoticeCooldown('whatsapp', row.userId))) {
      await this.notifications.updateDelivery(row.id, {
        whatsappStatus: NotificationDeliveryStatus.Skipped,
        whatsappNextRetryAt: null,
      });
      return;
    }

    const attempts = row.whatsappAttempts + 1;
    try {
      const text = row.listingId ? whatsappCards(cargoTextWithCard(row.text)) : await this.suggestionNoticeText(row.userId, WHATSAPP_SUGGESTIONS_HINT);
      const key = await this.whatsapp.sendNotification(jid, text);
      if (!row.listingId) this.markSuggestionNoticeSent('whatsapp', row.userId);
      await this.notifications.updateDelivery(row.id, {
        whatsappStatus: NotificationDeliveryStatus.Sent,
        whatsappMessageKey: key,
        whatsappSentAt: new Date(),
        whatsappAttempts: attempts,
        whatsappNextRetryAt: null,
      });
      await this.sendListingVoice(row, (audio) => this.whatsapp.sendVoice(jid, audio));
    } catch (error) {
      // خطاهای واتساپ (قطع socket، timeout) معمولاً موقت‌اند.
      const retryAt = nextDeliveryRetryAt(attempts, row.createdAt);
      this.logFailure('WhatsApp', row, attempts, retryAt, error);
      await this.notifications.updateDelivery(row.id, {
        whatsappStatus: retryAt ? NotificationDeliveryStatus.Pending : NotificationDeliveryStatus.Failed,
        whatsappAttempts: attempts,
        whatsappNextRetryAt: retryAt,
      });
    }
  }

  /**
   * بار اعلام‌شده برای راننده با صدا هم خوانده می‌شود (زیر همان پیام)، مثل جایگاه‌های سوخت.
   * راننده می‌تواند از «تنظیمات فیلتر» یا پروفایل خاموشش کند (cargoVoice).
   * خطای صدا فقط لاگ می‌شود؛ پیام متنی رسیده و وضعیت ارسال عوض نمی‌شود.
   */
  private async sendListingVoice(row: CargoNotification, send: (audio: Buffer) => Promise<unknown>): Promise<void> {
    if (!row.listing || !this.voice.available) return;
    try {
      if (!(await this.profiles.wantsCargoVoice(row.userId))) return;
      const audio = await this.voice.listingVoice(row.listing);
      if (audio) await send(audio);
    } catch (error) {
      this.logger.warn(`Cargo voice for notification ${row.id} failed: ${(error as Error).message}`);
    }
  }

  /** در این فاصله برای همین کاربر و پیام‌رسان اعلان پیشنهاد بار رفته است؟ */
  private inSuggestionNoticeCooldown(platform: BotPlatform | 'whatsapp', userId: string): boolean {
    const lastAt = this.lastSuggestionNoticeAt.get(`${platform}:${userId}`);
    return lastAt !== undefined && Date.now() - lastAt < SUGGESTION_NOTICE_COOLDOWN_MS;
  }

  // فقط بعد از ارسال موفق ثبت می‌شود تا ارسال ناموفق و تلاش مجددش رد نشوند.
  private markSuggestionNoticeSent(platform: BotPlatform | 'whatsapp', userId: string): void {
    const now = Date.now();
    for (const [key, at] of this.lastSuggestionNoticeAt) {
      if (now - at >= SUGGESTION_NOTICE_COOLDOWN_MS) this.lastSuggestionNoticeAt.delete(key);
    }
    this.lastSuggestionNoticeAt.set(`${platform}:${userId}`, now);
  }

  private async suggestionNoticeText(userId: string, openHint?: string): Promise<string> {
    return buildCargoSuggestionNotice(await this.notifications.countUnread(userId), openHint);
  }

  private logFailure(channel: string, row: CargoNotification, attempts: number, retryAt: Date | null, error: unknown) {
    this.logger.warn(
      `${channel} cargo notification ${row.id} failed (attempt ${attempts}, ` +
        `${retryAt ? `retry at ${retryAt.toISOString()}` : 'giving up'}): ${(error as Error).message}`,
    );
  }

  /*
   * =====================================================
   * Web API
   * =====================================================
   */

  /** پیشنهادی که کاربر با کد بار به آن اشاره می‌کند، حتی اگر با فیلترهای فعلی‌اش جور نباشد. */
  async findSuggestionByCode(userId: string, code: string) {
    const row = await this.notifications.findSuggestionByCode(userId, code);
    if (!row) return null;
    const published = await this.listings.findBySourceAndPublisher(row.sourceMessageId, userId);
    return this.toView(row, published ?? undefined);
  }

  async list(userId: string, options: SuggestionListOptions) {
    const [items, total] = await this.pageMatchingFilters(userId, options);

    // برای پیشنهادها: آیا همین کاربر این بار را قبلاً منتشر کرده است؟
    const suggestionSources = items.filter((row) => !row.listingId).map((row) => row.sourceMessageId);
    const published = new Map(
      (await this.listings.findManyBySourceAndPublisher(suggestionSources, userId)).map((l) => [l.sourceMessageId, l]),
    );

    return {
      items: items.map((row) => this.toView(row, row.listingId ? undefined : published.get(row.sourceMessageId))),
      total,
      page: options.page,
      pageSize: options.pageSize,
    };
  }

  /**
   * فیلترها موقع رسیدن بار اعمال می‌شوند، ولی کاربر ممکن است بعداً فیلتر را
   * عوض کند؛ پس لیست هم با فیلترهای فعال فعلی از نو غربال می‌شود تا آنچه
   * می‌بیند (و شمارنده‌ها) با تنظیماتش جور باشد. match روی متن آزاد در SQL
   * ممکن نیست، پس جدیدترین LIST_SCAN_LIMIT ردیف در برنامه فیلتر می‌شوند.
   */
  private async pageMatchingFilters(
    userId: string,
    options: SuggestionListOptions,
  ): Promise<[CargoNotification[], number]> {
    const skip = (options.page - 1) * options.pageSize;
    const filters = await this.filters.activeFor(userId);
    const search = prepareCargoSearch(options);
    if (filters.length === 0 && !search) {
      return this.notifications.findPageForUser(userId, {
        unreadOnly: options.unreadOnly,
        kind: options.kind,
        skip,
        take: options.pageSize,
      });
    }

    const rows = await this.notifications.findRecentForUser(userId, {
      unreadOnly: options.unreadOnly,
      kind: options.kind,
      take: LIST_SCAN_LIMIT,
    });
    const matching = rows.filter((row) => {
      const cargo = (row.payload ?? {}) as CargoRouteFields;
      return this.filters.matchesAny(filters, cargo) && (!search || matchesCargoSearch(cargo, search));
    });
    return [matching.slice(skip, skip + options.pageSize), matching.length];
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.notifications.countUnread(userId) };
  }

  async markRead(userId: string, id?: string): Promise<{ updated: number }> {
    return { updated: await this.notifications.markRead(userId, id) };
  }

  toView(row: CargoNotification, publishedListing?: CargoListing) {
    const listing = row.listing;
    return {
      id: row.id,
      kind: (row.listingId ? 'listing' : 'suggestion') as CargoNotificationKind,
      sourceMessageId: row.sourceMessageId,
      text: row.text,
      cargo: row.payload,
      // فقط برای راننده: وضعیت باری که شرکت منتشر کرده
      listing: listing
        ? {
            id: listing.id,
            status: listing.status,
            takenAt: listing.takenAt ?? null,
            companyName: listing.companyName ?? null,
            contactPhones: listing.contactPhones,
          }
        : null,
      // فقط برای شرکت: نسخه‌ای که خودش از این بار منتشر کرده (اگر کرده باشد)
      published: publishedListing ? { id: publishedListing.id, status: publishedListing.status } : null,
      isRead: row.isRead,
      readAt: row.readAt ?? null,
      createdAt: row.createdAt,
    };
  }
}
