import { CargoImageService } from './cargoImage.service';
import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';

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
import { BOT_DELIVERY_COLUMNS, DELIVERY_RETRY_WINDOW_MS, isPermanentTelegramError, nextDeliveryRetryAt, rateLimitWaitMs } from './cargoDeliveryRetry';
import { BotAction } from '../messengerBot/core/botDialog';
import { buildCargoDigestText, buildCargoTakenText, CARGO_DIGEST_MAX_ITEMS, CargoDigestItem } from './cargoNotificationText';
import { BotPlatform } from '../messengerBot/core/botPlatform';
import { buildCargoNotificationText, buildCargoSuggestionNotice, cargoTextWithCard } from './cargoNotificationText';
import { whatsappCards } from '../messengerBot/core/botCard';
import { CargoVoiceService } from './cargoVoice.service';
import { DriverProfileService } from '../driver/driverProfile.service';
import { CargoSearch, matchesCargoSearch, prepareCargoSearch } from './cargoSearch';
import { CargoTripTypeService } from './cargoTripType';
import { CARGO_NOTIFICATION_SOCKET_EVENT, NotificationsGateway } from './notifications.gateway';
import { TripAction } from '../../domain/constants/bot/TripAction';
import { RedisService } from '../redis/redis.service';
import { BrokerAccessService } from '../company/brokerAccess.service';
import { BROKER_ACCESS_ACTION } from '../company/brokerAccessDialog';
import { MESSENGER_ORDER, Messenger } from './messengerOrder';
import { UsageService } from '../analytics/usage.service';
import { WebPushService } from './webPush.service';

const BOT_PLATFORM_LABEL_EN: Record<BotPlatform, string> = { telegram: 'Telegram', bale: 'Bale', rubika: 'Rubika', eitaa: 'Eitaa' };

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
const BUY_REQUESTS_BUTTON = '🛒 خرید بسته‌ی درخواست';
const DETAIL_BUTTON = '🗺 مسیر و جزئیات';

// پیشنهاد بار در پیام‌رسان‌ها فقط با یک اعلان کوتاه خبر داده می‌شود و کاربر
// جزئیات را در «بارهای پیشنهادی» می‌بیند. دکمه‌ی ربات‌ها لیست خوانده‌نشده‌ها
// را در CargoDialog باز می‌کند؛ واتساپ دکمه ندارد و اسم بخش منو را می‌فرستد.
const SUGGESTIONS_BUTTON = '📥 بارهای پیشنهادی';
const SUGGESTIONS_UNREAD_ACTION = 'cg:sg:u:1';
const WHATSAPP_SUGGESTIONS_HINT = 'برای دیدن جزئیات، «بارهای شرکت حمل‌ونقل» را بفرستید.';
// تا یک دقیقه از آخرین بار، اعلان در جای خودش تازه می‌شود.
const SUGGESTION_BURST_MS = 60 * 1000;
const WHATSAPP_EDIT_WINDOW_MS = 14 * 60 * 1000;
// اعلان گوشی پیشنهادها: اولی همان لحظه با صدا، بقیه‌ی همان دقیقه یکجا و بی‌صدا جای همان را می‌گیرند.
const SUGGESTION_PUSH_WINDOW_SECONDS = 60;
const SUGGESTION_PUSH_TAG = 'cargo-suggestions';
const SUGGESTION_PUSH_URL = '/account/company/cargo';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ارسال اعلان بار در سه کانال (وب، تلگرام، واتساپ) و لیست اعلان‌های هر کاربر.
 *
 * دو نوع اعلان داریم:
 *  - پیشنهاد به شرکت: باری در کانالی که شرکت ثبت کرده دیده شد (handleCargoDetected).
 *  - بار منتشرشده برای راننده: شرکت آن را به نام خودش فرستاده (CargoListingService).
 */
/**
 * A driver's notice of a published load keeps no copy of it (CargoListingService.sendToDrivers): its text and details
 * are the load's own, so an edit of the load needs no update of every notice. Older notices and a company's
 * suggestions (no load yet) carry their own.
 */
/** One messenger's send: its status after it; retryAt when it is to be tried again; pauseMs when the messenger asked to slow down. */
export interface DeliveryResult {
  status: NotificationDeliveryStatus;
  retryAt?: Date | null;
  pauseMs?: number;
}

/** What the delivery queue does next with a job (CargoDeliveryQueue). */
export type QueuedOutcome =
  | { kind: 'done' }
  | { kind: 'retry'; at: Date; pauseMs?: number }
  | { kind: 'next'; messenger: Messenger }
  /** the user's held loads go in one summary message at `at` */
  | { kind: 'digest'; userId: string; at: Date; pauseMs?: number }
  /** sends for the queue to take on (notices a summary handed to their next messenger) */
  | { kind: 'jobs'; jobs: Array<{ id: string; messenger: Messenger; kind: 'send' }> };

/**
 * A driver's loads that come within this many seconds of one sent to it go together in one summary message
 * (CARGO_DIGEST_WINDOW_SECONDS; 0: each load its own message). The first load goes at once.
 */
const digestWindowSeconds = () => {
  const value = Number(process.env.CARGO_DIGEST_WINDOW_SECONDS ?? 120);
  return Number.isSafeInteger(value) && value >= 0 ? value : 120;
};
// held loads and «summary on its way» marks outlive a window by far: a summary late for a retry still finds them
const DIGEST_KEEP_SECONDS = 6 * 60 * 60;
const DIGEST_TEMPORARY_RETRY_MS = 60_000;
const FIND_CARGO_ACTION = 'cg:find:1';
// WhatsApp has no buttons: a load is asked for by its code through the assistant (request_driver_load)
const WHATSAPP_DIGEST_HINT = 'برای درخواست هر بار، «درخواست» و کد آن را بفرستید (مثلاً «درخواست TRB123»).';

// after WhatsApp's edit window (WHATSAPP_EDIT_WINDOW_MS) a taken load's message gets a reaction instead
const TAKEN_REACTION = '❌';

/** A notice's load as a line of a summary. */
function digestItem(row: CargoNotification): CargoDigestItem {
  const listing = row.listing!;
  return {
    code: listing.code, origin: listing.origin, destination: listing.destination, cargoType: listing.cargoType,
    weight: listing.weight, vehicleType: listing.vehicleType, price: listing.price, taken: listing.status === CargoListingStatus.Taken,
  };
}

/** A summary's buttons: the details of each load still open (by its number in the list), and all loads when some are not listed. */
function digestButtons(rows: CargoNotification[]): BotAction[] {
  const fa = (value: number) => value.toLocaleString('fa-IR');
  const details = rows.slice(0, CARGO_DIGEST_MAX_ITEMS).flatMap((row, index) =>
    row.listing && row.listing.status !== CargoListingStatus.Taken
      ? [{ id: `${TripAction.Detail}${row.listingId}`, label: `🔎 ${fa(index + 1)}`, row: Math.floor(index / 5) }]
      : []);
  return rows.length > CARGO_DIGEST_MAX_ITEMS
    ? [...details, { id: FIND_CARGO_ACTION, label: '🔎 همه‌ی بارها', row: Math.ceil(CARGO_DIGEST_MAX_ITEMS / 5) }]
    : details;
}

function noticeText(row: CargoNotification): string {
  return row.listing?.text ?? row.text;
}

function noticeCargo(row: CargoNotification): Record<string, unknown> {
  const listing = row.listing;
  if (!listing) return row.payload ?? {};
  const { code, origin, destination, cargoType, weight, vehicleType, price, extraNotes, companyName, contactPhones, tripType, photo } = listing;
  return { code, origin, destination, cargoType, weight, vehicleType, price, extraNotes, companyName, contactPhones, tripType, photo };
}

@Injectable()
export class CargoNotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(CargoNotificationService.name);

  // مثل صف منوها: حذف و ارسال اعلان‌های هم‌زمان یک شرکت پشت‌سرهم انجام می‌شود.
  private readonly suggestionDeliveries = new Map<string, Promise<void>>();

  // پایان پنجره‌ی اعلان گوشی هر شرکت (فقط در همین پروسه؛ با ریستارت فقط به‌روزرسانی آخر گم می‌شود)
  private readonly suggestionPushTimers = new Map<string, NodeJS.Timeout>();

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
    private readonly tripTypes: CargoTripTypeService,
    private readonly images: CargoImageService,
    @Optional() private readonly push?: WebPushService,
    @Optional() private readonly brokerAccess?: BrokerAccessService,
    @Optional() private readonly usage?: UsageService,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.suggestionPushTimers.values()) clearTimeout(timer);
    this.suggestionPushTimers.clear();
  }

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
    // داخلی/صادراتی/وارداتی از مبدأ و مقصد، تا لیست پیشنهادها با نوع سفر فیلتر شود؛ خطا (مثلاً
    // سرویس مکان در دسترس نیست) پیشنهاد را نگه نمی‌دارد، فقط نوعش نامعلوم می‌ماند
    const tripType = await this.tripTypes.classify(event.origin ?? '', event.destination ?? '').catch((error: Error) => {
      this.logger.warn(`Trip type of cargo message ${event.messageId} unknown: ${error.message}`);
      return null;
    });
    const createdIds = await this.notifications.insertIgnoringDuplicates(
      recipients.map((userId) => ({
        userId,
        sourceMessageId: event.messageId,
        text,
        payload: { ...event, tripType } as Record<string, unknown>,
      })),
    );

    const rows = await this.notifications.findSuggestions(event.messageId, recipients);
    for (const row of rows) {
      if (createdIds.has(row.id)) {
        this.gateway.sendToUser(row.userId, CARGO_NOTIFICATION_SOCKET_EVENT, this.toView(row));
        // منتظرش نمی‌مانیم و خطایش بالا نمی‌رود: پیام nack نشود و ربات‌ها دوباره ارسال نکنند
        void this.pushSuggestions(row.userId);
      }
      await this.deliver(row);
    }

    this.logger.log(
      `Cargo message ${event.messageId}: ${createdIds.size} new suggestion(s) for ${recipients.length} company user(s)`,
    );
  }

  /**
   * بار کارخانه برای یک شرکت حمل‌ونقل (FactoryService): مثل بار کانال‌ها در «پیشنهادها»ی همان شرکت می‌نشیند و
   * در وب، ربات‌ها و واتساپ خبر داده می‌شود. شرکت خودش کارخانه را دعوت کرده، پس اشتراک و فیلتر نمایش بار
   * جلوی رسیدنش را نمی‌گیرند (فیلتر فقط در لیست اعمال می‌شود).
   */
  async suggestFactoryCargo(
    companyUserId: string,
    event: CargoDetectedEvent,
    factory: { userId: string; name: string; phones: string[] },
  ): Promise<void> {
    const header = [`🏭 کارخانه: ${factory.name}`, factory.phones.length ? `تماس کارخانه: ${factory.phones.join(' - ')}` : ''].filter(Boolean).join('\n');
    const text = `${header}\n${buildCargoNotificationText(event)}`.slice(0, 3500);
    const tripType = await this.tripTypes.classify(event.origin ?? '', event.destination ?? '').catch(() => null);
    const createdIds = await this.notifications.insertIgnoringDuplicates([
      {
        userId: companyUserId,
        sourceMessageId: event.messageId,
        text,
        payload: { ...event, tripType, source: 'FACTORY', factory } as Record<string, unknown>,
      },
    ]);
    for (const row of await this.notifications.findSuggestions(event.messageId, [companyUserId])) {
      if (createdIds.has(row.id)) {
        this.gateway.sendToUser(row.userId, CARGO_NOTIFICATION_SOCKET_EVENT, this.toView(row));
        void this.pushSuggestions(row.userId);
      }
      await this.deliver(row);
    }
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
    await this.deliverThroughOne(row, await this.canDeliverListing(row), () => true);
  }

  /** تلاش مجدد کانال‌هایی که زمانشان رسیده (صدا زده شده از CargoDeliveryRetryWorker). */
  async retryDelivery(row: CargoNotification, now = new Date()): Promise<void> {
    return this.withSuggestionQueue(row, () => this.retryDeliveryNow(row, now));
  }

  private async retryDeliveryNow(row: CargoNotification, now: Date): Promise<void> {
    // one never tried yet has no time: its turn is now
    const due = (messenger: Messenger) => {
      const nextRetryAt = row[this.deliveryColumns(messenger).nextRetryAt];
      return !nextRetryAt || nextRetryAt.getTime() <= now.getTime();
    };
    await this.deliverThroughOne(row, await this.canDeliverListing(row), due);
  }

  private deliveryColumns(messenger: Messenger): { status: 'telegramStatus' | 'baleStatus' | 'rubikaStatus' | 'eitaaStatus' | 'whatsappStatus'; nextRetryAt: 'telegramNextRetryAt' | 'baleNextRetryAt' | 'rubikaNextRetryAt' | 'eitaaNextRetryAt' | 'whatsappNextRetryAt' } {
    return messenger === 'whatsapp' ? { status: 'whatsappStatus', nextRetryAt: 'whatsappNextRetryAt' } : BOT_DELIVERY_COLUMNS[messenger];
  }

  /**
   * One messenger per notice (MESSENGER_ORDER): the first the user has linked gets it; one that cannot (not linked, or
   * failed for good) hands it to the next. Once one has it (sent, or waiting to try again), the rest are skipped, so
   * neither this nor the retry worker sends it twice. ready: whether a messenger may be tried now (the retry worker
   * tries one only when its time has come).
   */
  private async deliverThroughOne(row: CargoNotification, isOpen: boolean, ready: (messenger: Messenger) => boolean): Promise<void> {
    // one messenger has it already: none of the others
    let taken = MESSENGER_ORDER.some((messenger) => row[this.deliveryColumns(messenger).status] === NotificationDeliveryStatus.Sent);
    for (const messenger of MESSENGER_ORDER) {
      const columns = this.deliveryColumns(messenger);
      const status = row[columns.status];
      if (taken) {
        if (status === NotificationDeliveryStatus.Pending) {
          await this.notifications.updateDelivery(row.id, { [columns.status]: NotificationDeliveryStatus.Skipped, [columns.nextRetryAt]: null } as CargoNotificationDelivery);
        }
        continue;
      }
      if (status === NotificationDeliveryStatus.Sent) taken = true;
      if (status !== NotificationDeliveryStatus.Pending) continue;
      if (!ready(messenger)) {
        taken = true;
        continue;
      }
      const { status: result } = messenger === 'whatsapp' ? await this.deliverWhatsapp(row, isOpen) : await this.deliverBot(messenger, row, isOpen);
      taken = result === NotificationDeliveryStatus.Sent || result === NotificationDeliveryStatus.Pending;
    }
  }

  /** ارسال با ربات تلگرام، بله یا روبیکا (همه از MessengerBotService / MultiBot)؛ وضعیت این پیام‌رسان بعد از آن. */
  private async deliverBot(platform: BotPlatform, row: CargoNotification, isOpen: boolean): Promise<DeliveryResult> {
    const columns = BOT_DELIVERY_COLUMNS[platform];
    if (row[columns.status] !== NotificationDeliveryStatus.Pending) return { status: row[columns.status] };

    const update = (changes: Record<string, unknown>) =>
      this.notifications.updateDelivery(row.id, changes as CargoNotificationDelivery);

    const link = isOpen && this.bots.hasPlatform(platform)
      ? await this.botLinks.findByUserId(row.userId, platform)
      : null;
    if (!link?.chatId) {
      await update({ [columns.status]: NotificationDeliveryStatus.Skipped, [columns.nextRetryAt]: null });
      return { status: NotificationDeliveryStatus.Skipped };
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
      // نمایش تصویری: عکس بار پیش از پیام خودش (جدا، تا ویرایش‌های بعدی پیام دست نخورد)؛ فقط بار اول
      if (row.listingId && row[columns.attempts] === 0) {
        const chatId = link.chatId;
        await this.sendListingImage(row, (image, reuseKey) => this.bots.sendPhotoNotification(chatId, image, undefined, reuseKey));
      }
      // بار اعلام‌شده برای راننده: دکمه‌ی «درخواست این بار»؛ با «برداشته شد»
      // پیام ویرایش و دکمه برداشته می‌شود. پیشنهاد بار: فقط اعلان کوتاه.
      const messageId = previous ? previous[columns.messageId]! : row.listingId
        ? await this.bots.sendActionNotification(link.chatId, cargoTextWithCard(noticeText(row)), await this.listingButtons(row))
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
      const wait = rateLimitWaitMs(error);
      if (wait !== null) {
        // the messenger asks to slow down: no fault of this notice, so no attempt is counted
        const retryAt = new Date(Date.now() + wait);
        await update({ [columns.nextRetryAt]: retryAt });
        return { status: NotificationDeliveryStatus.Pending, retryAt, pauseMs: wait };
      }
      const retryAt = isPermanentTelegramError(error) ? null : nextDeliveryRetryAt(attempts, row.createdAt);
      this.logFailure(BOT_PLATFORM_LABEL_EN[platform], row, attempts, retryAt, error);
      await update({
        [columns.status]: retryAt ? NotificationDeliveryStatus.Pending : NotificationDeliveryStatus.Failed,
        [columns.attempts]: attempts,
        [columns.nextRetryAt]: retryAt,
      });
      return { status: retryAt ? NotificationDeliveryStatus.Pending : NotificationDeliveryStatus.Failed, retryAt };
    }
    const chatId = link.chatId;
    await this.sendListingVoice(row, (audio, reuseKey) => this.bots.sendVoiceNotification(chatId, audio, undefined, reuseKey));
    if (row.listingId) void this.usage?.delivered(platform);
    return { status: NotificationDeliveryStatus.Sent };
  }

  /**
   * The messengers each of these users can get a notice through, in MESSENGER_ORDER (none: only the app). Looked up
   * for all of them at once: a load is announced to thousands of drivers.
   */
  async routes(userIds: string[]): Promise<Map<string, Messenger[]>> {
    const [links, whatsapp] = await Promise.all([this.botLinks.findAllByUserIds(userIds), this.whatsapp.linkedUserIds(userIds)]);
    const bots = new Map<string, Set<string>>();
    for (const link of links) {
      if (!link.chatId || !this.bots.hasPlatform(link.platform)) continue;
      bots.set(link.userId, (bots.get(link.userId) ?? new Set()).add(link.platform));
    }
    return new Map(userIds.map((userId) => [
      userId,
      MESSENGER_ORDER.filter((messenger) => (messenger === 'whatsapp' ? whatsapp.has(userId) : !!bots.get(userId)?.has(messenger))),
    ]));
  }

  /**
   * A queued send of a load's notice through one messenger (CargoDeliveryQueue). The notice is read as it is now:
   * one another messenger already sent, or one gone stale (DELIVERY_RETRY_WINDOW_MS), is not sent. A messenger that
   * cannot take it (not linked any more, or failed for good) hands it to the next one still pending.
   */
  async deliverQueued(notificationId: string, messenger: Messenger, now = new Date()): Promise<QueuedOutcome> {
    const row = await this.notifications.findWithListing(notificationId);
    if (!row) return { kind: 'done' };
    const columns = this.deliveryColumns(messenger);
    if (row[columns.status] !== NotificationDeliveryStatus.Pending) return { kind: 'done' };
    const sentElsewhere = MESSENGER_ORDER.some((other) => row[this.deliveryColumns(other).status] === NotificationDeliveryStatus.Sent);
    if (sentElsewhere || now.getTime() - row.createdAt.getTime() > DELIVERY_RETRY_WINDOW_MS) {
      const status = sentElsewhere ? NotificationDeliveryStatus.Skipped : NotificationDeliveryStatus.Failed;
      await this.notifications.updateDelivery(row.id, { [columns.status]: status, [columns.nextRetryAt]: null } as CargoNotificationDelivery);
      return { kind: 'done' };
    }

    // a load sent to this driver a moment ago: this one waits, to go with the others in one message
    if (row.listingId) {
      const held = await this.holdForDigest(row, messenger);
      if (held) return held;
    }

    const isOpen = await this.canDeliverListing(row);
    const result = messenger === 'whatsapp' ? await this.deliverWhatsapp(row, isOpen) : await this.deliverBot(messenger, row, isOpen);
    if (result.status === NotificationDeliveryStatus.Pending && result.retryAt) return { kind: 'retry', at: result.retryAt, pauseMs: result.pauseMs };
    if (result.status === NotificationDeliveryStatus.Sent) {
      // the rest stay unsent, for good
      for (const other of MESSENGER_ORDER) {
        const otherColumns = this.deliveryColumns(other);
        if (other !== messenger && row[otherColumns.status] === NotificationDeliveryStatus.Pending) {
          await this.notifications.updateDelivery(row.id, { [otherColumns.status]: NotificationDeliveryStatus.Skipped, [otherColumns.nextRetryAt]: null } as CargoNotificationDelivery);
        }
      }
      return { kind: 'done' };
    }
    if (!isOpen) return { kind: 'done' };
    const next = MESSENGER_ORDER.slice(MESSENGER_ORDER.indexOf(messenger) + 1)
      .find((other) => row[this.deliveryColumns(other).status] === NotificationDeliveryStatus.Pending);
    return next ? { kind: 'next', messenger: next } : { kind: 'done' };
  }

  /**
   * The first load in a while goes alone and opens the driver's window in this messenger; one within the window is
   * held for the summary (and the first held one schedules it, for the window's end). Null: send it now. A Redis
   * failure sends it now too.
   */
  private async holdForDigest(row: CargoNotification, messenger: Messenger): Promise<QueuedOutcome | null> {
    const window = digestWindowSeconds();
    if (!window) return null;
    try {
      const windowKey = RedisService.key('cargoDigestWindow', messenger, row.userId);
      if (await this.redis.setIfAbsent(windowKey, '1', window)) return null;
      const pendingKey = RedisService.key('cargoDigestPending', messenger, row.userId);
      await this.redis.hashSet(pendingKey, row.id, '1');
      await this.redis.expire(pendingKey, DIGEST_KEEP_SECONDS);
      if (!(await this.redis.setIfAbsent(RedisService.key('cargoDigestScheduled', messenger, row.userId), '1', DIGEST_KEEP_SECONDS))) {
        return { kind: 'done' };
      }
      const left = await this.redis.ttl(windowKey);
      return { kind: 'digest', userId: row.userId, at: new Date(Date.now() + Math.max(1, left) * 1000) };
    } catch (error) {
      this.logger.warn(`Cargo summary hold for ${row.userId} failed; sent alone: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * The loads held for a driver in one messenger, sent together: one summary message (a line and a details button
   * each), or the one left as its own message. Each notice gets the summary's message id, so taking one of its loads
   * edits the summary. A messenger that cannot take it hands each notice to its next one.
   */
  async deliverDigest(userId: string, messenger: Messenger, now = new Date()): Promise<QueuedOutcome> {
    const columns = this.deliveryColumns(messenger);
    const pendingKey = RedisService.key('cargoDigestPending', messenger, userId);
    await this.redis.delete(RedisService.key('cargoDigestScheduled', messenger, userId));
    const ids = Object.keys(await this.redis.hashGetAll(pendingKey));
    await this.redis.hashDelete(pendingKey, ...ids);

    const rows: CargoNotification[] = [];
    for (const row of await this.notifications.findManyWithListing(ids)) {
      if (row[columns.status] !== NotificationDeliveryStatus.Pending) continue;
      const sentElsewhere = MESSENGER_ORDER.some((other) => row[this.deliveryColumns(other).status] === NotificationDeliveryStatus.Sent);
      const stale = now.getTime() - row.createdAt.getTime() > DELIVERY_RETRY_WINDOW_MS;
      if (sentElsewhere || stale || !(await this.canDeliverListing(row))) {
        const status = stale ? NotificationDeliveryStatus.Failed : NotificationDeliveryStatus.Skipped;
        await this.notifications.updateDelivery(row.id, { [columns.status]: status, [columns.nextRetryAt]: null } as CargoNotificationDelivery);
        continue;
      }
      rows.push(row);
    }
    if (!rows.length) return { kind: 'done' };
    // one load left: its own message (the window is over by now, so it is not held again)
    if (rows.length === 1) return { kind: 'jobs', jobs: [{ id: rows[0].id, messenger, kind: 'send' }] };

    const window = digestWindowSeconds();
    try {
      let sent: CargoNotificationDelivery;
      if (messenger === 'whatsapp') {
        const jid = await this.whatsapp.getJidForUsername(userId);
        if (!jid) return this.handOn(rows, messenger, NotificationDeliveryStatus.Skipped);
        const key = await this.whatsapp.sendNotification(jid, buildCargoDigestText(rows.map(digestItem), WHATSAPP_DIGEST_HINT));
        sent = { whatsappStatus: NotificationDeliveryStatus.Sent, whatsappMessageKey: key, whatsappSentAt: now, whatsappNextRetryAt: null };
      } else {
        const botColumns = BOT_DELIVERY_COLUMNS[messenger];
        const link = this.bots.hasPlatform(messenger) ? await this.botLinks.findByUserId(userId, messenger) : null;
        if (!link?.chatId) return this.handOn(rows, messenger, NotificationDeliveryStatus.Skipped);
        const messageId = await this.bots.sendActionNotification(link.chatId, buildCargoDigestText(rows.map(digestItem)), digestButtons(rows));
        sent = {
          [botColumns.status]: NotificationDeliveryStatus.Sent,
          [botColumns.chatId]: link.chatId,
          [botColumns.messageId]: messenger === 'telegram' ? messageId : String(messageId),
          [botColumns.nextRetryAt]: null,
        } as CargoNotificationDelivery;
      }
      for (const row of rows) {
        await this.notifications.updateDelivery(row.id, sent);
        for (const other of MESSENGER_ORDER) {
          const otherColumns = this.deliveryColumns(other);
          if (other !== messenger && row[otherColumns.status] === NotificationDeliveryStatus.Pending) {
            await this.notifications.updateDelivery(row.id, { [otherColumns.status]: NotificationDeliveryStatus.Skipped, [otherColumns.nextRetryAt]: null } as CargoNotificationDelivery);
          }
        }
      }
      void this.usage?.delivered(messenger, rows.length);
      // loads that keep coming go in the next summary
      if (window) await this.redis.set(RedisService.key('cargoDigestWindow', messenger, userId), '1', window);
      return { kind: 'done' };
    } catch (error) {
      const wait = rateLimitWaitMs(error);
      if (wait === null && messenger !== 'whatsapp' && isPermanentTelegramError(error)) {
        this.logger.warn(`Cargo summary to ${userId} on ${messenger} failed for good: ${(error as Error).message}`);
        return this.handOn(rows, messenger, NotificationDeliveryStatus.Failed);
      }
      // held again, for a summary a little later
      for (const row of rows) await this.redis.hashSet(pendingKey, row.id, '1');
      await this.redis.expire(pendingKey, DIGEST_KEEP_SECONDS);
      await this.redis.setIfAbsent(RedisService.key('cargoDigestScheduled', messenger, userId), '1', DIGEST_KEEP_SECONDS);
      if (wait === null) this.logger.warn(`Cargo summary to ${userId} on ${messenger} failed; tried again: ${(error as Error).message}`);
      return { kind: 'digest', userId, at: new Date(now.getTime() + (wait ?? DIGEST_TEMPORARY_RETRY_MS)), ...(wait !== null && { pauseMs: wait }) };
    }
  }

  /** A summary this messenger cannot take: each notice marked so, and sent through its next messenger still pending. */
  private async handOn(rows: CargoNotification[], messenger: Messenger, status: NotificationDeliveryStatus): Promise<QueuedOutcome> {
    const columns = this.deliveryColumns(messenger);
    const jobs: Array<{ id: string; messenger: Messenger; kind: 'send' }> = [];
    for (const row of rows) {
      await this.notifications.updateDelivery(row.id, { [columns.status]: status, [columns.nextRetryAt]: null } as CargoNotificationDelivery);
      const next = MESSENGER_ORDER.slice(MESSENGER_ORDER.indexOf(messenger) + 1)
        .find((other) => row[this.deliveryColumns(other).status] === NotificationDeliveryStatus.Pending);
      if (next) jobs.push({ id: row.id, messenger: next, kind: 'send' });
    }
    return jobs.length ? { kind: 'jobs', jobs } : { kind: 'done' };
  }

  /**
   * A queued edit of a load's message in the messenger that has it, to match the load as it is now: taken (marked,
   * no buttons) or open again, or its new text (a new phone number). An edit that fails is only logged, except a
   * «slow down», which is tried again.
   */
  async editQueued(notificationId: string, messenger: Messenger): Promise<QueuedOutcome> {
    const row = await this.notifications.findWithListing(notificationId);
    const listing = row?.listing;
    if (!row || !listing) return { kind: 'done' };
    const taken = listing.status === CargoListingStatus.Taken;
    const text = cargoTextWithCard(taken ? buildCargoTakenText(listing.text) : listing.text);
    try {
      if (messenger === 'whatsapp') {
        const key = row.whatsappMessageKey;
        if (!key?.remoteJid || !key.id) return { kind: 'done' };
        // a summary: its lines as its loads are now; its reaction only once all of them are taken
        const summary = await this.notifications.findByMessage('whatsapp', key.remoteJid, key.id);
        const many = summary.length > 1;
        const allTaken = many ? summary.every((item) => item.listing?.status === CargoListingStatus.Taken) : taken;
        const canEdit = row.whatsappSentAt && Date.now() - row.whatsappSentAt.getTime() < WHATSAPP_EDIT_WINDOW_MS;
        if (canEdit) await this.whatsapp.editNotification(key, many ? buildCargoDigestText(summary.map(digestItem), WHATSAPP_DIGEST_HINT) : whatsappCards(text));
        else if (!many || allTaken) await this.whatsapp.reactToNotification(key, allTaken ? TAKEN_REACTION : '');
        return { kind: 'done' };
      }
      const columns = BOT_DELIVERY_COLUMNS[messenger];
      const chatId = row[columns.chatId];
      const messageId = row[columns.messageId];
      if (!chatId || !messageId) return { kind: 'done' };
      const summary = await this.notifications.findByMessage(messenger, chatId, String(messageId));
      if (summary.length > 1) {
        await this.bots.editNotification(chatId, messageId, buildCargoDigestText(summary.map(digestItem)), digestButtons(summary));
        return { kind: 'done' };
      }
      await this.bots.editNotification(chatId, messageId, text, taken ? [] : await this.listingButtons(row));
    } catch (error) {
      const wait = rateLimitWaitMs(error);
      if (wait !== null) return { kind: 'retry', at: new Date(Date.now() + wait), pauseMs: wait };
      this.logger.warn(`Editing cargo notice ${row.id} on ${messenger} failed: ${(error as Error).message}`);
    }
    return { kind: 'done' };
  }

  /** A load's buttons in a driver's messenger: its details, and a request (or, for a broker out of requests, buying more). */
  private async listingButtons(row: CargoNotification): Promise<BotAction[]> {
    const outOfRequests = !!(await this.brokerAccess?.outOfRequests(row.userId));
    return [
      { id: `${TripAction.Detail}${row.listingId}`, label: DETAIL_BUTTON, row: 0 },
      outOfRequests
        ? { id: BROKER_ACCESS_ACTION, label: BUY_REQUESTS_BUTTON, row: 0 }
        : { id: `${TripAction.Request}${row.listingId}`, label: REQUEST_BUTTON, row: 0 },
    ];
  }

  /**
   * A user who sees loads as pictures (User.cargoDisplay = IMAGE) gets the load's picture (its photo, or one of its
   * kind) before its message. A failure only logs: the message itself still goes.
   */
  private async sendListingImage(row: CargoNotification, send: (image: Buffer, reuseKey: string) => Promise<unknown>): Promise<void> {
    if (!row.listingId) return;
    try {
      if ((await this.audience.cargoDisplayOf(row.userId)) !== 'IMAGE') return;
      const listing = row.listing ?? (await this.listings.findById(row.listingId));
      // the same picture to every driver: uploaded once, then sent again by its file id
      if (listing) await send(await this.images.image(listing), `cargo-image:${listing.id}:${listing.updatedAt?.getTime() ?? ''}`);
    } catch (error) {
      this.logger.warn(`Picture of listing ${row.listingId} to ${row.userId} failed: ${(error as Error).message}`);
    }
  }

  private async canDeliverListing(row: CargoNotification): Promise<boolean> {
    if (row.listing?.status === CargoListingStatus.Taken) return false;
    if (!row.listing) return true;
    return this.profiles.canReceiveAnnouncement(row.userId, row.listing.publisherUserId, row.listing.tripType);
  }

  private async deliverWhatsapp(row: CargoNotification, isOpen: boolean): Promise<DeliveryResult> {
    if (row.whatsappStatus !== NotificationDeliveryStatus.Pending) return { status: row.whatsappStatus };

    const jid = isOpen ? await this.whatsapp.getJidForUsername(row.userId) : null;
    if (!jid) {
      await this.notifications.updateDelivery(row.id, {
        whatsappStatus: NotificationDeliveryStatus.Skipped,
        whatsappNextRetryAt: null,
      });
      return { status: NotificationDeliveryStatus.Skipped };
    }

    const attempts = row.whatsappAttempts + 1;
    try {
      const text = row.listingId ? whatsappCards(cargoTextWithCard(noticeText(row))) : await this.suggestionNoticeText(row.userId, WHATSAPP_SUGGESTIONS_HINT);
      const previous = !row.listingId ? await this.recentSuggestionNotice(row.userId, 'whatsapp', jid) : null;
      if (previous) {
        await this.whatsapp.editNotification(previous.whatsappMessageKey!, text);
      } else if (!row.listingId) {
        await this.deleteSuggestionNotices(row.userId, 'whatsapp');
      }
      if (row.listingId && row.whatsappAttempts === 0) await this.sendListingImage(row, (image) => this.whatsapp.sendImage(jid, image));
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
      if (row.listingId) void this.usage?.delivered('whatsapp');
      return { status: NotificationDeliveryStatus.Sent };
    } catch (error) {
      // خطاهای واتساپ (قطع socket، timeout) معمولاً موقت‌اند.
      const retryAt = nextDeliveryRetryAt(attempts, row.createdAt);
      this.logFailure('WhatsApp', row, attempts, retryAt, error);
      await this.notifications.updateDelivery(row.id, {
        whatsappStatus: retryAt ? NotificationDeliveryStatus.Pending : NotificationDeliveryStatus.Failed,
        whatsappAttempts: attempts,
        whatsappNextRetryAt: retryAt,
      });
      return { status: retryAt ? NotificationDeliveryStatus.Pending : NotificationDeliveryStatus.Failed, retryAt };
    }
  }

  /**
   * بار اعلام‌شده برای راننده با صدا هم خوانده می‌شود (زیر همان پیام)، مثل جایگاه‌های سوخت.
   * راننده می‌تواند از «تنظیمات فیلتر» یا پروفایل خاموشش کند (cargoVoice).
   * خطای صدا فقط لاگ می‌شود؛ پیام متنی رسیده و وضعیت ارسال عوض نمی‌شود.
   */
  private async sendListingVoice(row: CargoNotification, send: (audio: Buffer, reuseKey: string) => Promise<unknown>): Promise<void> {
    if (!row.listing || !this.voice.available) return;
    try {
      if (!(await this.profiles.wantsCargoVoice(row.userId))) return;
      const audio = await this.voice.listingVoice(row.listing);
      if (audio) await send(audio, `cargo-voice:${row.listing.id}:${row.listing.updatedAt?.getTime() ?? ''}`);
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

  /**
   * اعلان گوشی پیشنهاد بار. ده‌ها بار ممکن است در یک لحظه برسند؛ گوشی فقط یک اعلان می‌بیند:
   *  - اولین بار پنجره: همان لحظه، با صدا (renotify تا جای اعلان قدیمیِ مانده را هم با صدا بگیرد).
   *  - بقیه‌ی پنجره: فقط علامت می‌خورد؛ آخر پنجره یک اعلان بی‌صدا با همان tag عدد را درست می‌کند
   *    و اگر بار باز هم آمد پنجره‌ی بعدی بی‌صدا ادامه می‌دهد.
   * خطا فقط لاگ می‌شود.
   */
  private async pushSuggestions(userId: string): Promise<void> {
    if (!this.push?.enabled) return;
    try {
      const windowKey = RedisService.key('cargoSuggestionPushWindow', userId);
      if (await this.redis.setIfAbsent(windowKey, '1', SUGGESTION_PUSH_WINDOW_SECONDS)) {
        await this.sendSuggestionPush(userId, true);
        this.scheduleSuggestionPush(userId);
      } else {
        await this.redis.set(RedisService.key('cargoSuggestionPushPending', userId), '1', SUGGESTION_PUSH_WINDOW_SECONDS * 2);
      }
    } catch (error) {
      this.logger.warn(`Cargo suggestion web push to ${userId} failed: ${(error as Error).message}`);
    }
  }

  private scheduleSuggestionPush(userId: string): void {
    clearTimeout(this.suggestionPushTimers.get(userId));
    const timer = setTimeout(() => void this.flushSuggestionPush(userId), SUGGESTION_PUSH_WINDOW_SECONDS * 1000);
    timer.unref?.();
    this.suggestionPushTimers.set(userId, timer);
  }

  private async flushSuggestionPush(userId: string): Promise<void> {
    this.suggestionPushTimers.delete(userId);
    try {
      if (!(await this.redis.take(RedisService.key('cargoSuggestionPushPending', userId)))) return;
      await this.redis.set(RedisService.key('cargoSuggestionPushWindow', userId), '1', SUGGESTION_PUSH_WINDOW_SECONDS);
      await this.sendSuggestionPush(userId, false);
      this.scheduleSuggestionPush(userId);
    } catch (error) {
      this.logger.warn(`Cargo suggestion web push to ${userId} failed: ${(error as Error).message}`);
    }
  }

  private async sendSuggestionPush(userId: string, renotify: boolean): Promise<void> {
    await this.push!.sendToUser(userId, {
      title: 'ترابوت · بار پیشنهادی',
      body: await this.suggestionNoticeText(userId),
      url: SUGGESTION_PUSH_URL,
      tag: SUGGESTION_PUSH_TAG,
      renotify,
    });
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
      const cargo = noticeCargo(row) as CargoRouteFields;
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
      text: noticeText(row),
      cargo: noticeCargo(row),
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
