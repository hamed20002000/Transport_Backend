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
import { RedisService } from '../redis/redis.service';

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
// تا یک دقیقه از آخرین بار، اعلان در جای خودش تازه می‌شود.
const SUGGESTION_BURST_MS = 60 * 1000;
const WHATSAPP_EDIT_WINDOW_MS = 14 * 60 * 1000;

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

  // مثل صف منوها: حذف و ارسال اعلان‌های هم‌زمان یک شرکت پشت‌سرهم انجام می‌شود.
  private readonly suggestionDeliveries = new Map<string, Promise<void>>();

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
    private readonly redis: RedisService,
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
    return this.withSuggestionQueue(row, () => this.deliverNow(row));
  }

  private async deliverNow(row: CargoNotification): Promise<void> {
    const isOpen = await this.canDeliverListing(row);
    // هر پیام‌رسانی که کاربر وصل کرده جدا ارسال می‌شود؛ فیلتر بودن یکی جلوی بقیه را نمی‌گیرد.
    for (const platform of BOT_PLATFORMS) await this.deliverBot(platform, row, isOpen);
    await this.deliverWhatsapp(row, isOpen);
  }

  /** تلاش مجدد کانال‌هایی که زمانشان رسیده (صدا زده شده از CargoDeliveryRetryWorker). */
  async retryDelivery(row: CargoNotification, now = new Date()): Promise<void> {
    return this.withSuggestionQueue(row, () => this.retryDeliveryNow(row, now));
  }

  private async retryDeliveryNow(row: CargoNotification, now: Date): Promise<void> {
    const isOpen = await this.canDeliverListing(row);
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
    if (!link?.chatId) {
      await update({ [columns.status]: NotificationDeliveryStatus.Skipped, [columns.nextRetryAt]: null });
      return;
    }

    const attempts = row[columns.attempts] + 1;
    try {
      const previous = !row.listingId ? await this.recentSuggestionNotice(row.userId, platform, link.chatId) : null;
      if (previous) {
        await this.bots.editNotification(link.chatId, previous[columns.messageId]!, await this.suggestionNoticeText(row.userId), [
          { id: SUGGESTIONS_UNREAD_ACTION, label: SUGGESTIONS_BUTTON, row: 0 },
        ]);
      } else if (!row.listingId) {
        await this.deleteSuggestionNotices(row.userId, platform);
      }
      // بار اعلام‌شده برای راننده: دکمه‌ی «درخواست این بار»؛ با «برداشته شد»
      // پیام ویرایش و دکمه برداشته می‌شود. پیشنهاد بار: فقط اعلان کوتاه.
      const messageId = previous ? previous[columns.messageId]! : row.listingId
        ? await this.bots.sendActionNotification(link.chatId, cargoTextWithCard(row.text), [
            { id: `${TripAction.Detail}${row.listingId}`, label: DETAIL_BUTTON, row: 0 },
            { id: `${TripAction.Request}${row.listingId}`, label: REQUEST_BUTTON, row: 0 },
          ])
        : await this.bots.sendActionNotification(link.chatId, await this.suggestionNoticeText(row.userId), [
            { id: SUGGESTIONS_UNREAD_ACTION, label: SUGGESTIONS_BUTTON, row: 0 },
          ]);
      await update({
        [columns.status]: NotificationDeliveryStatus.Sent,
        [columns.chatId]: link.chatId,
        // تلگرام ستون integer دارد؛ شناسه‌ی پیام روبیکا عدد نیست.
        [columns.messageId]: platform === 'telegram' ? messageId : String(messageId),
        [columns.attempts]: attempts,
        [columns.nextRetryAt]: null,
      });
      if (previous && previous.id !== row.id) {
        await this.notifications.updateDelivery(previous.id, { [columns.messageId]: null });
      }
      if (!row.listingId) await this.markSuggestionActivity(row, platform);
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

  private async canDeliverListing(row: CargoNotification): Promise<boolean> {
    if (row.listing?.status === CargoListingStatus.Taken) return false;
    if (!row.listing) return true;
    return this.profiles.canReceiveAnnouncement(row.userId, row.listing.publisherUserId, row.listing.tripType);
  }

  private async deliverWhatsapp(row: CargoNotification, isOpen: boolean): Promise<void> {
    if (row.whatsappStatus !== NotificationDeliveryStatus.Pending) return;

    const jid = isOpen ? await this.whatsapp.getJidForUsername(row.userId) : null;
    if (!jid) {
      await this.notifications.updateDelivery(row.id, {
        whatsappStatus: NotificationDeliveryStatus.Skipped,
        whatsappNextRetryAt: null,
      });
      return;
    }

    const attempts = row.whatsappAttempts + 1;
    try {
      const text = row.listingId ? whatsappCards(cargoTextWithCard(row.text)) : await this.suggestionNoticeText(row.userId, WHATSAPP_SUGGESTIONS_HINT);
      const previous = !row.listingId ? await this.recentSuggestionNotice(row.userId, 'whatsapp', jid) : null;
      if (previous) {
        await this.whatsapp.editNotification(previous.whatsappMessageKey!, text);
      } else if (!row.listingId) {
        await this.deleteSuggestionNotices(row.userId, 'whatsapp');
      }
      const key = previous ? previous.whatsappMessageKey! : await this.whatsapp.sendNotification(jid, text);
      await this.notifications.updateDelivery(row.id, {
        whatsappStatus: NotificationDeliveryStatus.Sent,
        whatsappMessageKey: key,
        whatsappSentAt: previous ? previous.whatsappSentAt : new Date(),
        whatsappAttempts: attempts,
        whatsappNextRetryAt: null,
      });
      if (previous && previous.id !== row.id) {
        await this.notifications.updateDelivery(previous.id, { whatsappMessageKey: null });
      }
      if (!row.listingId) await this.markSuggestionActivity(row, 'whatsapp');
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

  private async withSuggestionQueue(row: CargoNotification, send: () => Promise<void>): Promise<void> {
    if (row.listingId) return send();
    const operation = (this.suggestionDeliveries.get(row.userId) ?? Promise.resolve()).then(send);
    const settled = operation.catch(() => undefined);
    this.suggestionDeliveries.set(row.userId, settled);
    try {
      await operation;
    } finally {
      if (this.suggestionDeliveries.get(row.userId) === settled) this.suggestionDeliveries.delete(row.userId);
    }
  }

  private async deleteSuggestionNotices(userId: string, platform: BotPlatform | 'whatsapp'): Promise<void> {
    const previous = await this.notifications.findSuggestionNotices(userId, platform);
    for (const notice of previous) {
      if (platform === 'whatsapp') {
        if (!notice.whatsappMessageKey) continue;
        await this.whatsapp.deleteNotification(notice.whatsappMessageKey);
        await this.notifications.updateDelivery(notice.id, { whatsappMessageKey: null });
      } else {
        const columns = BOT_DELIVERY_COLUMNS[platform];
        const chatId = notice[columns.chatId];
        const messageId = notice[columns.messageId];
        if (!chatId || messageId == null) continue;
        await this.bots.deleteNotification(chatId, messageId);
        await this.notifications.updateDelivery(notice.id, { [columns.messageId]: null });
      }
    }
  }

  private async recentSuggestionNotice(userId: string, platform: BotPlatform | 'whatsapp', chatId: string): Promise<CargoNotification | null> {
    const notices = await this.notifications.findSuggestionNotices(userId, platform);
    // اعلان‌های قدیمیِ چندتایی با همان مسیر حذف و ارسال به یک اعلان تبدیل می‌شوند.
    if (notices.length !== 1) return null;
    const notice = notices[0];
    const activity = await this.redis.getJson<{ notificationId: string; at: number }>(this.suggestionActivityKey(userId, platform));
    if (!activity || activity.notificationId !== notice.id || Date.now() - activity.at >= SUGGESTION_BURST_MS) return null;
    if (platform === 'whatsapp') {
      if (notice.whatsappMessageKey?.remoteJid !== chatId || !notice.whatsappSentAt
        || Date.now() - notice.whatsappSentAt.getTime() >= WHATSAPP_EDIT_WINDOW_MS) return null;
    } else {
      const columns = BOT_DELIVERY_COLUMNS[platform];
      if (notice[columns.chatId] !== chatId || notice[columns.messageId] == null) return null;
    }
    return notice;
  }

  private suggestionActivityKey(userId: string, platform: BotPlatform | 'whatsapp'): string {
    return RedisService.key('cargoSuggestionNoticeActivity', platform, userId);
  }

  private async markSuggestionActivity(row: CargoNotification, platform: BotPlatform | 'whatsapp'): Promise<void> {
    await this.redis.setJson(this.suggestionActivityKey(row.userId, platform), {
      notificationId: row.id,
      at: Date.now(),
    }, SUGGESTION_BURST_MS / 1000);
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
      return (row.payload?.registeredByCompany === true || this.filters.matchesAny(filters, cargo)) && (!search || matchesCargoSearch(cargo, search));
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
      published: publishedListing ? { id: publishedListing.id, status: publishedListing.status, announcedAt: publishedListing.announcedAt ?? null } : null,
      isRead: row.isRead,
      readAt: row.readAt ?? null,
      createdAt: row.createdAt,
    };
  }
}
