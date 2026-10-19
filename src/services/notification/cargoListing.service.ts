import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { QueryFailedError } from 'typeorm';

import { CargoDetectedEvent } from '../../domain/constants/cargoEvents';
import { CargoListing } from '../../domain/entities/notification/CargoListing';
import { CargoNotification } from '../../domain/entities/notification/CargoNotification';
import { CargoListingStatus, CargoTripType, NotificationDeliveryStatus } from '../../domain/enums/notification';
import { CargoSearch, matchesCargoSearch, prepareCargoSearch } from './cargoSearch';
import { CargoAudienceRepository } from '../../infrastructure/repositories/notification/cargoAudience.repository';
import { CargoListingRepository } from '../../infrastructure/repositories/notification/cargoListing.repository';
import { CargoNotificationRepository } from '../../infrastructure/repositories/notification/cargoNotification.repository';
import { CargoRequestRepository } from '../../infrastructure/repositories/notification/cargoRequest.repository';
import { WhatsappService } from '../../application/services/agent/services/whatsapp.service';
import { MessengerBotService } from '../messengerBot/core/messengerBot.service';
import { CargoAlertFilterService } from './cargoAlertFilter.service';
import { CargoNotificationService } from './cargoNotification.service';
import { SubscriptionPolicyService } from '../subscription/subscriptionPolicy.service';
import { buildCargoListingText, buildCargoTakenText, cargoTextWithCard, CargoListingFields } from './cargoNotificationText';
import { whatsappCards } from '../messengerBot/core/botCard';
import { CargoTripTypeService } from './cargoTripType';
import { CompanyAnnounceService } from './companyAnnounce.service';
import { NoCargoRecipientsException } from './cargoAnnouncementError';
import { AgentGateway } from '../../application/services/agent/agent.gateway';
import { BOT_LINK_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { IBotLinkRepository } from '../../domain/repositories/messengerBot/IBotLinkRepository';
import { BOT_PLATFORMS } from '../messengerBot/core/botPlatform';
import {
  CARGO_LISTING_CHANGED_SOCKET_EVENT,
  CARGO_NOTIFICATION_SOCKET_EVENT,
  CARGO_STATUS_SOCKET_EVENT,
  NotificationsGateway,
} from './notifications.gateway';

// واتساپ ویرایش را تا ۱۵ دقیقه قبول می‌کند؛ با کمی حاشیه‌ی اطمینان.
const WHATSAPP_EDIT_WINDOW_MS = 14 * 60 * 1000;

const TAKEN_REACTION = '❌';

const OPEN_SCAN_LIMIT = 1000;

// ارسال به راننده‌ها در پس‌زمینه انجام می‌شود؛ اگر برنامه وسط کار بسته شود،
// worker تلاش مجدد بعد از این مدت ارسال‌های باقی‌مانده را می‌فرستد.
const PUBLISH_SAFETY_RETRY_MS = 5 * 60 * 1000;

/**
 * انتشار بار توسط شرکت برای راننده‌ها و اعلام «برداشته شد».
 *
 * جریان: شرکت پیشنهاد بار را می‌بیند → نمونه‌ی متن (فیلد: مقدار) می‌گیرد →
 * تأیید یا ویرایش می‌کند → بار به نام و شماره‌ی خودش برای راننده‌های مشترکی
 * که فیلترشان match است فرستاده می‌شود → وقتی راننده‌ای بار را برداشت، شرکت
 * «برداشته شد» می‌زند و پیام همه‌ی راننده‌ها ویرایش می‌شود.
 */
@Injectable()
export class CargoListingService {
  private readonly logger = new Logger(CargoListingService.name);

  constructor(
    private readonly listings: CargoListingRepository,
    private readonly notifications: CargoNotificationRepository,
    private readonly audience: CargoAudienceRepository,
    private readonly filters: CargoAlertFilterService,
    private readonly delivery: CargoNotificationService,
    private readonly bots: MessengerBotService,
    @Inject(forwardRef(() => WhatsappService))
    private readonly whatsapp: WhatsappService,
    private readonly gateway: NotificationsGateway,
    private readonly policy: SubscriptionPolicyService,
    private readonly tripTypes: CargoTripTypeService,
    private readonly announceSettings: CompanyAnnounceService,
    @Inject(forwardRef(() => AgentGateway)) private readonly agentGateway: AgentGateway,
    @Inject(BOT_LINK_REPOSITORY) private readonly botLinks: IBotLinkRepository,
    private readonly requests: CargoRequestRepository,
  ) {}

  /** نمونه‌ی پیشنهادی برای انتشار؛ شرکت می‌تواند قبل از ارسال ویرایشش کند. */
  async buildDraft(userId: string, notificationId: string): Promise<CargoListingFields & { text: string }> {
    const suggestion = await this.getSuggestion(userId, notificationId);
    const cargo = suggestion.payload as Partial<CargoDetectedEvent>;
    const contact = await this.audience.findPublisherContact(userId);

    const fields: CargoListingFields = {
      code: cargo.code ?? null,
      companyName: contact.company?.name || null,
      origin: cargo.origin ?? '',
      destination: cargo.destination ?? '',
      cargoType: cargo.cargoType ?? null,
      weight: cargo.weight ?? null,
      vehicleType: cargo.vehicleType ?? null,
      price: cargo.price ?? null,
      extraNotes: cargo.extraNotes ?? null,
      contactPhones: [...new Set([contact.mobile, contact.company?.phone].filter((p): p is string => !!p?.trim()))],
    };

    return { ...fields, text: buildCargoListingText(fields) };
  }

  /** نام شرکت و شماره‌های تماس پیش‌فرض برای فرم ثبت بار دستی. */
  async buildManualDraft(userId: string): Promise<Pick<CargoListingFields, 'companyName' | 'contactPhones'>> {
    const contact = await this.audience.findPublisherContact(userId);
    return {
      companyName: contact.company?.name || null,
      contactPhones: [...new Set([contact.mobile, contact.company?.phone].filter((p): p is string => !!p?.trim()))],
    };
  }

  async publish(userId: string, notificationId: string, fields: CargoListingFields) {
    const suggestion = await this.getSuggestion(userId, notificationId);
    const existing = await this.listings.findBySourceAndPublisher(suggestion.sourceMessageId, userId);
    if (existing?.announcedAt === null && existing.status === CargoListingStatus.Open) return this.announceNow(userId, existing.id);
    if (existing) {
      throw new ConflictException('You have already published this cargo.');
    }
    // رویدادهای قدیمی کد ندارند؛ آن‌ها مثل بار دستی کد می‌گیرند.
    const code = (suggestion.payload as Partial<CargoDetectedEvent>).code ?? await this.listings.nextManualCode();
    return this.publishListing(userId, { ...fields, code }, suggestion.sourceMessageId, suggestion.id, true);
  }

  /**
   * بار دستی که شرکت خودش ثبت می‌کند (از هیچ کانالی نیامده). شناسه‌ی منبع
   * یکتا ساخته می‌شود تا ایندکس (sourceMessageId, publisherUserId) و اعلان
   * راننده‌ها مثل بارهای منتشرشده از پیشنهاد کار کنند.
   */
  async createManual(userId: string, fields: CargoListingFields) {
    const code = await this.listings.nextManualCode();
    // اعلام خودکار: بار در صف می‌ماند و در نوبت بعدی اعلام می‌شود
    const announce = !(await this.announceSettings.isAuto(userId));
    return this.publishListing(userId, { ...fields, code }, `manual:${randomUUID()}`, null, announce);
  }

  /** «📣 اعلام همین الان»: بار باز شرکت به راننده‌های همان نوع (بار در صف یا اعلام دوباره). */
  async announceNow(userId: string, listingId: string) {
    const listing = await this.listings.findOneForPublisher(listingId, userId);
    if (!listing) throw new NotFoundException('Cargo listing not found.');
    if (listing.status !== CargoListingStatus.Open) throw new ConflictException('Only open cargo can be announced.');
    const recipients = await this.announcementRecipients(userId, listing.tripType, listing);
    listing.announcedAt = new Date();
    const saved = await this.listings.save(listing);
    await this.announceChange(saved);
    const sent = await this.sendToDrivers(saved, recipients);
    return { ...this.toView(saved), recipients: sent, pending: false, nextAnnounceAt: null };
  }

  /**
   * نوبت اعلام خودکار یک شرکت: پیشنهادهای تازه‌ی کانال‌ها (از روشن شدن خودکار، با مبدأ،
   * مقصد و شماره‌ی تماس) منتشر می‌شوند و بارهای ثبت‌شده‌ی در صف اعلام می‌شوند.
   */
  async autoAnnounce(userId: string, since: Date): Promise<{ suggestions: number; pending: number }> {
    let suggestions = 0;
    for (const suggestion of await this.notifications.findSuggestionsSince(userId, since)) {
      if (await this.listings.findBySourceAndPublisher(suggestion.sourceMessageId, userId)) continue;
      const draft = await this.buildDraft(userId, suggestion.id);
      if (!draft.origin.trim() || !draft.destination.trim() || !draft.contactPhones.length) continue;
      try {
        const result = await this.publish(userId, suggestion.id, draft);
        if (!result.pending) suggestions++;
      } catch (error) {
        if (!(error instanceof ConflictException) && !(error instanceof NoCargoRecipientsException)) throw error;
      }
    }
    let pending = 0;
    for (const listing of await this.listings.findPendingAnnounce(userId)) {
      let recipients: string[];
      try {
        recipients = await this.announcementRecipients(userId, listing.tripType, listing);
      } catch (error) {
        if (error instanceof NoCargoRecipientsException) continue;
        throw error;
      }
      listing.announcedAt = new Date();
      const saved = await this.listings.save(listing);
      await this.announceChange(saved);
      await this.sendToDrivers(saved, recipients);
      pending++;
    }
    return { suggestions, pending };
  }

  private async publishListing(
    userId: string,
    fields: CargoListingFields & { code: string },
    sourceMessageId: string,
    sourceNotificationId: string | null,
    announce: boolean,
  ) {
    const contact = await this.audience.findPublisherContact(userId);
    // داخلی/صادراتی/وارداتی همیشه از مبدأ و مقصد؛ شرکت انتخابش نمی‌کند
    const tripType = await this.tripTypes.classify(fields.origin, fields.destination);
    let driverIds: string[] = [];
    if (announce) {
      try {
        driverIds = await this.announcementRecipients(userId, tripType, fields);
      } catch (error) {
        if (!(error instanceof NoCargoRecipientsException)) throw error;
      }
    }
    const willAnnounce = announce && driverIds.length > 0;
    const listing = await this.saveListing(
      this.listings.create({
        ...fields,
        tripType,
        text: buildCargoListingText({ ...fields, tripType }),
        sourceMessageId,
        sourceNotificationId,
        publisherUserId: userId,
        companyId: contact.company?.id ?? null,
        status: CargoListingStatus.Open,
        announcedAt: willAnnounce ? new Date() : null,
      }),
    );
    if (!willAnnounce) {
      if (!sourceNotificationId) {
        await this.notifications.insertIgnoringDuplicates([{
          userId,
          sourceMessageId,
          text: listing.text,
          payload: { ...fields, tripType, rawText: listing.text, registeredByCompany: true },
          telegramStatus: NotificationDeliveryStatus.Skipped,
          baleStatus: NotificationDeliveryStatus.Skipped,
          rubikaStatus: NotificationDeliveryStatus.Skipped,
          whatsappStatus: NotificationDeliveryStatus.Skipped,
        }]);
      }
      await this.announceChange(listing);
      const { nextRunAt } = await this.announceSettings.get(userId);
      return {
        ...this.toView(listing), recipients: 0, pending: true,
        pendingReason: announce ? 'noDrivers' as const : 'automatic' as const,
        message: announce ? 'بار ثبت شد، اما به‌دلیل نبود راننده مناسب اعلام نشد؛ در بارهای پیشنهادی قابل مشاهده است.' : undefined,
        nextAnnounceAt: nextRunAt,
      };
    }
    await this.announceChange(listing);
    const recipients = await this.sendToDrivers(listing, driverIds);
    return { ...this.toView(listing), recipients, pending: false, nextAnnounceAt: null };
  }

  /** اعلان بار به راننده‌های همان نوع (داخلی/صادراتی/وارداتی) که فیلترشان جور است. */
  private async announcementRecipients(userId: string, tripType: CargoTripType, fields: CargoListingFields): Promise<string[]> {
    const drivers = (await this.audience.findDriverIds(await this.policy.isRequired(), tripType, userId)).filter(
      (id) => id !== userId,
    );
    const recipients = await this.filters.filterInterestedUsers(drivers, fields);
    if (!recipients.length) throw new NoCargoRecipientsException();
    return recipients;
  }

  private async sendToDrivers(listing: CargoListing, recipients: string[]): Promise<number> {

    const safetyRetryAt = new Date(Date.now() + PUBLISH_SAFETY_RETRY_MS);
    await this.notifications.insertIgnoringDuplicates(
      recipients.map((driverId) => ({
        userId: driverId,
        sourceMessageId: listing.sourceMessageId,
        listingId: listing.id,
        text: listing.text,
        payload: this.toView(listing) as unknown as Record<string, unknown>,
        telegramNextRetryAt: safetyRetryAt,
        baleNextRetryAt: safetyRetryAt,
        rubikaNextRetryAt: safetyRetryAt,
        whatsappNextRetryAt: safetyRetryAt,
      })),
    );

    // اعلام دوباره: راننده‌ای که قبلاً گرفته ردیفش «ارسال‌شده» است و deliver دوباره نمی‌فرستد
    const rows = (await this.notifications.findByListing(listing.id)).filter((row) => recipients.includes(row.userId));
    for (const row of rows) {
      this.gateway.sendToUser(row.userId, CARGO_NOTIFICATION_SOCKET_EVENT, this.delivery.toView(row));
    }

    // تلگرام/واتساپ برای تعداد زیاد راننده زمان می‌برد؛ درخواست شرکت منتظر نمی‌ماند.
    void this.dispatch(listing, rows);

    this.logger.log(`Listing ${listing.id} (${listing.tripType}) announced to ${rows.length} driver(s)`);
    return rows.length;
  }

  private async dispatch(listing: CargoListing, rows: CargoNotification[]): Promise<void> {
    try {
      for (const row of rows) {
        await this.delivery.deliver(row);
      }
    } catch (error) {
      this.logger.error(`Dispatching listing ${listing.id} failed; the retry worker will resume it`, (error as Error).stack);
    }
  }

  /**
   * «برداشته شد» (TAKEN) یا برگرداندن (OPEN). فقط شرکتی که بار را منتشر کرده
   * می‌تواند وضعیتش را عوض کند؛ پیام همه‌ی راننده‌ها در هر سه کانال ویرایش می‌شود.
   */
  findById(listingId: string): Promise<CargoListing | null> {
    return this.listings.findById(listingId);
  }

  async findByCode(code: string) {
    const listing = await this.listings.findByCode(code);
    return listing ? this.toView(listing) : null;
  }

  async findMineByCode(userId: string, code: string) {
    const listing = await this.listings.findByCodeForPublisher(code, userId);
    return listing ? this.toView(listing) : null;
  }

  async setStatus(userId: string, listingId: string, status: CargoListingStatus) {
    const listing = await this.listings.findOneForPublisher(listingId, userId);
    if (!listing) throw new NotFoundException('Cargo listing not found.');
    // باری که سفرش در جریان است (یا به راننده‌ای سپرده شده) دوباره باز نمی‌شود؛ وگرنه دو سفر برای یک بار
    if (status === CargoListingStatus.Open && (await this.requests.hasActiveTrip(listing.id))) {
      // کد مثل بقیه‌ی خطاهای سفر (taken، reserved…) تا وب و ربات پیام خودشان را نشان دهند
      throw new ConflictException('activeTrip');
    }

    if (!(await this.listings.changeStatus(listing.id, status))) {
      return this.toView(listing);
    }

    const updated = (await this.listings.findOneForPublisher(listingId, userId))!;
    await this.propagateStatus(updated);
    return this.toView(updated);
  }

  /** بارهای خود شرکت؛ با search فقط آن‌هایی که با مبدأ/مقصد/نوع بار/ماشین گفته‌شده جورند. */
  async listMine(
    userId: string,
    options: { status?: CargoListingStatus; page: number; pageSize: number } & CargoSearch,
  ) {
    const skip = (options.page - 1) * options.pageSize;
    const search = prepareCargoSearch(options);
    let items: CargoListing[];
    let total: number;
    if (!search) {
      [items, total] = await this.listings.findPageForPublisher(userId, {
        status: options.status,
        skip,
        take: options.pageSize,
      });
    } else {
      const [recent] = await this.listings.findPageForPublisher(userId, {
        status: options.status,
        skip: 0,
        take: OPEN_SCAN_LIMIT,
      });
      const matching = recent.filter((listing) => matchesCargoSearch(listing, search));
      items = matching.slice(skip, skip + options.pageSize);
      total = matching.length;
    }

    return {
      items: items.map((listing) => this.toView(listing)),
      total,
      page: options.page,
      pageSize: options.pageSize,
    };
  }

  /** بارهای باز همه‌ی شرکت‌ها برای راننده؛ متن هر بار همان پیامی است که برای راننده‌ها فرستاده شد. */
  /** شرکت‌هایی که بار اعلام کرده‌اند، برای انتخاب در فیلتر راننده. */
  companyNames(limit = 20): Promise<string[]> {
    return this.listings.findPublisherCompanyNames(limit);
  }

  /**
   * بارهای باز؛ با userId فقط آن‌هایی که با فیلترهای فعال آن کاربر جورند (مثل
   * اعلانی که برایش می‌رود). match روی متن آزاد در SQL ممکن نیست، پس
   * جدیدترین OPEN_SCAN_LIMIT بار در برنامه فیلتر می‌شوند.
   */
  /** tripType: فقط بارهای همین نوع (فهرست بار راننده، مثل اعلام بار فقط به راننده‌های همان نوع). */
  async listOpen(options: { page: number; pageSize: number; userId?: string; tripType?: CargoTripType; tripTypes?: CargoTripType[] } & CargoSearch) {
    const skip = (options.page - 1) * options.pageSize;
    const filters = options.userId ? await this.filters.activeFor(options.userId) : [];
    // جستجوی مبدأ/مقصد/نوع بار/ماشین («شامل بودن» مثل فیلترها)؛ بار برگشتی هم از همین استفاده می‌کند
    const search = prepareCargoSearch(options);
    let items: CargoListing[];
    let total: number;
    if (filters.length === 0 && !search) {
      [items, total] = await this.listings.findOpenPage({ skip, take: options.pageSize, tripType: options.tripType, ...(options.tripTypes && { tripTypes: options.tripTypes }) });
    } else {
      const [recent] = await this.listings.findOpenPage({ skip: 0, take: OPEN_SCAN_LIMIT, tripType: options.tripType, ...(options.tripTypes && { tripTypes: options.tripTypes }) });
      const matching = recent.filter(
        (listing) => this.filters.matchesAny(filters, listing) && (!search || matchesCargoSearch(listing, search)),
      );
      items = matching.slice(skip, skip + options.pageSize);
      total = matching.length;
    }

    return { items: items.map((listing) => this.toView(listing)), total, page: options.page, pageSize: options.pageSize };
  }

  /** لیست بارهای باز همه‌ی راننده‌ها (نه فقط گیرنده‌های اعلان) بروز شود. */
  private async announceChange(listing: CargoListing): Promise<void> {
    this.gateway.broadcast(CARGO_LISTING_CHANGED_SOCKET_EVENT, {
      listingId: listing.id,
      status: listing.status,
      takenAt: listing.takenAt ?? null,
    });
    await this.agentGateway.broadcastDomainChange(listing.publisherUserId, 'company_my_cargo', {});
    // ارسال پیام‌رسان‌ها نباید اعلام تغییر به وب یا پاسخ ثبت بار را معطل کند.
    void this.refreshPublisherMenus(listing.publisherUserId);
  }

  private async refreshPublisherMenus(userId: string): Promise<void> {
    for (const platform of BOT_PLATFORMS) {
      try {
        if (!this.bots.hasPlatform(platform)) continue;
        const link = await this.botLinks.findByUserId(userId, platform);
        if (link?.chatId) await this.bots.refreshCargoMenu(link.chatId, link.externalUserId, userId);
      } catch (error) {
        this.logger.warn(`Cargo menu refresh via ${platform} failed: ${(error as Error).message}`);
      }
    }
    try {
      await this.whatsapp.refreshCargoMenu(userId);
    } catch (error) {
      this.logger.warn(`Cargo menu refresh via whatsapp failed: ${(error as Error).message}`);
    }
  }

  private async propagateStatus(listing: CargoListing): Promise<void> {
    const taken = listing.status === CargoListingStatus.Taken;
    await this.announceChange(listing);
    const rows = await this.notifications.findByListing(listing.id);

    for (const row of rows) {
      this.gateway.sendToUser(row.userId, CARGO_STATUS_SOCKET_EVENT, {
        id: row.id,
        listingId: listing.id,
        status: listing.status,
        takenAt: listing.takenAt ?? null,
      });

      const text = cargoTextWithCard(taken ? buildCargoTakenText(row.text) : row.text);

      // پیام‌های ربات‌ها (تلگرام، بله، روبیکا) -- chatId پیشونددار مسیر را تعیین می‌کند.
      const botMessages: [string, string | null | undefined, number | string | null | undefined][] = [
        ['Telegram', row.telegramChatId, row.telegramMessageId],
        ['Bale', row.baleChatId, row.baleMessageId],
        ['Rubika', row.rubikaChatId, row.rubikaMessageId],
      ];
      for (const [channel, chatId, messageId] of botMessages) {
        if (!chatId || !messageId) continue;
        await this.tryUpdate(`${channel} edit`, row, () => this.bots.editNotification(chatId, messageId, text));
      }

      if (row.whatsappMessageKey?.remoteJid) {
        const key = row.whatsappMessageKey;
        const canEdit = row.whatsappSentAt && Date.now() - row.whatsappSentAt.getTime() < WHATSAPP_EDIT_WINDOW_MS;

        await this.tryUpdate('WhatsApp update', row, () =>
          canEdit
            ? this.whatsapp.editNotification(key, whatsappCards(text))
            : this.whatsapp.reactToNotification(key, taken ? TAKEN_REACTION : ''),
        );
      }
    }

    this.logger.log(`Listing ${listing.id} is now ${listing.status}; updated ${rows.length} driver notification(s)`);
  }

  /** ویرایش پیام قبلی؛ خطا فقط لاگ می‌شود تا بقیه‌ی راننده‌ها به‌روز شوند. */
  private async tryUpdate(channel: string, row: CargoNotification, update: () => Promise<void>): Promise<void> {
    try {
      await update();
    } catch (error) {
      this.logger.warn(`${channel} of cargo notification ${row.id} failed: ${(error as Error).message}`);
    }
  }

  private async getSuggestion(userId: string, notificationId: string): Promise<CargoNotification> {
    const suggestion = await this.notifications.findOneForUser(notificationId, userId);
    if (!suggestion || suggestion.listingId) throw new NotFoundException('Cargo suggestion not found.');
    return suggestion;
  }

  private async saveListing(listing: CargoListing): Promise<CargoListing> {
    try {
      return await this.listings.save(listing);
    } catch (error) {
      // دو درخواست همزمان از یک کاربر: ایندکس یکتا جلوی دومی را می‌گیرد.
      if (error instanceof QueryFailedError && (error as QueryFailedError & { code?: string }).code === '23505') {
        throw new ConflictException('You have already published this cargo.');
      }
      throw error;
    }
  }

  toView(listing: CargoListing) {
    return {
      id: listing.id,
      code: listing.code,
      sourceMessageId: listing.sourceMessageId,
      companyName: listing.companyName ?? null,
      origin: listing.origin,
      destination: listing.destination,
      cargoType: listing.cargoType ?? null,
      weight: listing.weight ?? null,
      vehicleType: listing.vehicleType ?? null,
      price: listing.price ?? null,
      extraNotes: listing.extraNotes ?? null,
      contactPhones: listing.contactPhones,
      text: listing.text,
      status: listing.status,
      takenAt: listing.takenAt ?? null,
      tripType: listing.tripType,
      // null یعنی در صف اعلام خودکار
      announcedAt: listing.announcedAt ?? null,
      createdAt: listing.createdAt,
    };
  }
}
