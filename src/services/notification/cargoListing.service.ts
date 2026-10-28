import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { QueryFailedError } from 'typeorm';

import { CargoDetectedEvent } from '../../domain/constants/cargoEvents';
import { CargoListing } from '../../domain/entities/notification/CargoListing';
import { CargoNotification } from '../../domain/entities/notification/CargoNotification';
import { CargoListingStatus, CargoTripType } from '../../domain/enums/notification';
import { CargoSearch, matchesCargoSearch, prepareCargoSearch } from './cargoSearch';
import { CargoAudienceRepository, type PublisherContact } from '../../infrastructure/repositories/notification/cargoAudience.repository';
import { CargoListingRepository, type ListingStage } from '../../infrastructure/repositories/notification/cargoListing.repository';
import { CargoNotificationRepository } from '../../infrastructure/repositories/notification/cargoNotification.repository';
import { CargoRequestRepository } from '../../infrastructure/repositories/notification/cargoRequest.repository';
import { WhatsappService } from '../../application/services/agent/services/whatsapp.service';
import { MessengerBotService } from '../messengerBot/core/messengerBot.service';
import { CargoAlertFilterService } from './cargoAlertFilter.service';
import { CargoNotificationService } from './cargoNotification.service';
import { SubscriptionPolicyService } from '../subscription/subscriptionPolicy.service';
import { buildCargoListingText, buildCargoTakenText, cargoTextWithCard, CargoListingFields } from './cargoNotificationText';
import { whatsappCards } from '../messengerBot/core/botCard';
import { CargoTripTypeService, driverKindForLoad, parseTripType } from './cargoTripType';
import { CompanyAnnounceService } from './companyAnnounce.service';
import { WebPushService } from './webPush.service';
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
/** The phones a load gets from the publisher's profile when none are typed for it: the mobile, then the office phone. */
export function publisherPhones(contact: PublisherContact): string[] {
  return [...new Set([contact.mobile, contact.company?.phone].filter((p): p is string => !!p?.trim()))];
}

/**
 * The company name a load shows: its name for international work on an export or import load, its name for
 * domestic work on a domestic one, the company's own name when that one is not set.
 */
export function companyNameFor(contact: PublisherContact, tripType: CargoTripType | null | undefined): string | null {
  const company = contact.company;
  if (!company) return null;
  const kindName = driverKindForLoad(tripType) === 'INTERNATIONAL' ? company.internationalName : company.domesticName;
  return kindName || company.name || null;
}

/**
 * A load's phones after the profile phones changed. A load that carried all the old profile phones (it was
 * published with them) gets the new ones instead. A load that carried only some, next to phones typed for it,
 * gets each removed one swapped for an added one in order (dropped when none is left); nothing else is added.
 * A typed phone always stays, and a load left with no phone keeps its old ones.
 */
export function replaceContactPhones(phones: string[], from: string[], to: string[]): string[] {
  if (!phones.some((phone) => from.includes(phone))) return phones;
  const next: string[] = [];
  const push = (phone: string) => !next.includes(phone) && next.push(phone);
  if (from.every((phone) => phones.includes(phone))) {
    for (const phone of phones) (from.includes(phone) ? to : [phone]).forEach(push);
    // the new profile phones it did not have yet (the old list was shorter)
    to.forEach(push);
  } else {
    const added = to.filter((phone) => !from.includes(phone));
    for (const phone of phones) {
      if (!from.includes(phone) || to.includes(phone)) push(phone);
      else if (added.length) push(added.shift()!);
    }
  }
  return next.length ? next : phones;
}

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
/** Loads announced to each driver in one auto-announce turn, for a single phone notification at its end. */
type PushBatch = Map<string, CargoListing[]>;

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
    private readonly push: WebPushService,
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
    return { companyName: contact.company?.name || null, contactPhones: publisherPhones(contact) };
  }

  /**
   * The publisher changed the name or phones its loads show: every load of its still showing the old ones gets the
   * new ones (a phone typed for a single load stays), text included, so drivers do not call an old number. The
   * messages already sent for an open load are edited too, in the background. Returns the loads changed.
   */
  async refreshPublisherContact(userId: string, before: PublisherContact, after: PublisherContact): Promise<CargoListing[]> {
    const from = { phones: publisherPhones(before) };
    const to = { phones: publisherPhones(after) };
    const samePhones = from.phones.length === to.phones.length && from.phones.every((phone) => to.phones.includes(phone));
    // the name each kind of load showed and shows now (CargoTripType: domestic, export, import)
    const loadTypes = Object.values(CargoTripType);
    const renamed = loadTypes.filter((type) => companyNameFor(before, type) !== companyNameFor(after, type));
    if (samePhones && !renamed.length) return [];
    const oldNames = [...new Set(renamed.map((type) => companyNameFor(before, type)).filter((name): name is string => !!name))];

    const changed: CargoListing[] = [];
    for (const listing of await this.listings.findByPublisherContact(userId, samePhones ? [] : from.phones, oldNames)) {
      const contactPhones = replaceContactPhones(listing.contactPhones, from.phones, to.phones);
      // only a load still showing the name of its kind; a name typed for that one load stays
      const companyName =
        listing.companyName && listing.companyName === companyNameFor(before, listing.tripType) ? companyNameFor(after, listing.tripType) : listing.companyName;
      if (companyName === listing.companyName && contactPhones === listing.contactPhones) continue;
      listing.contactPhones = contactPhones;
      listing.companyName = companyName;
      listing.text = buildCargoListingText(listing as CargoListingFields);
      changed.push(await this.listings.save(listing));
    }
    void this.propagateText(changed.filter((listing) => listing.status === CargoListingStatus.Open));
    return changed;
  }

  /** The drivers' copies of these loads (web list and the messages already sent) get the loads' new text. */
  private async propagateText(listings: CargoListing[]): Promise<void> {
    for (const listing of listings) {
      try {
        await this.notifications.updateTextByListing(listing.id, listing.text);
        for (const row of await this.notifications.findByListing(listing.id)) await this.editSent(row, cargoTextWithCard(listing.text));
      } catch (error) {
        this.logger.warn(`Contact update of listing ${listing.id} failed: ${(error as Error).message}`);
      }
    }
  }

  async publish(userId: string, notificationId: string, fields: CargoListingFields, pushBatch?: PushBatch) {
    const suggestion = await this.getSuggestion(userId, notificationId);
    const existing = await this.listings.findBySourceAndPublisher(suggestion.sourceMessageId, userId);
    if (existing?.announcedAt === null && existing.status === CargoListingStatus.Open) return this.announceNow(userId, existing.id);
    if (existing) {
      throw new ConflictException('You have already published this cargo.');
    }
    // رویدادهای قدیمی کد ندارند؛ آن‌ها مثل بار دستی کد می‌گیرند.
    const code = (suggestion.payload as Partial<CargoDetectedEvent>).code ?? await this.listings.nextManualCode();
    // a factory's load keeps the factory's photo unless the company puts its own
    const photo = fields.photo ?? ((suggestion.payload as { photo?: string | null }).photo || null);
    return this.publishListing(userId, { ...fields, code, photo }, suggestion.sourceMessageId, suggestion.id, true, pushBatch);
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

  /** بارهای باز خود شرکت که هنوز اعلام نشده‌اند (راننده‌ی مناسب نبود، یا در صف اعلام خودکار)، جدیدترین اول. */
  async unannounced(userId: string) {
    const listings = await this.listings.findPendingAnnounce(userId);
    return listings.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((listing) => this.toView(listing));
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
    // ده بار در یک نوبت = یک اعلان گوشی برای هر راننده، نه ده اعلان
    const pushBatch: PushBatch = new Map();
    let suggestions = 0;
    for (const suggestion of await this.notifications.findSuggestionsSince(userId, since)) {
      if (await this.listings.findBySourceAndPublisher(suggestion.sourceMessageId, userId)) continue;
      const draft = await this.buildDraft(userId, suggestion.id);
      if (!draft.origin.trim() || !draft.destination.trim() || !draft.contactPhones.length) continue;
      try {
        const result = await this.publish(userId, suggestion.id, draft, pushBatch);
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
      await this.sendToDrivers(saved, recipients, pushBatch);
      pending++;
    }
    await this.sendPushBatch(pushBatch);
    return { suggestions, pending };
  }

  private async publishListing(
    userId: string,
    fields: CargoListingFields & { code: string },
    sourceMessageId: string,
    sourceNotificationId: string | null,
    announce: boolean,
    pushBatch?: PushBatch,
  ) {
    const contact = await this.audience.findPublisherContact(userId);
    // داخلی/صادراتی/وارداتی همیشه از مبدأ و مقصد؛ شرکت انتخابش نمی‌کند
    const tripType = await this.tripTypes.classifyListing(fields.origin, fields.destination);
    let driverIds: string[] = [];
    if (announce) {
      try {
        driverIds = await this.announcementRecipients(userId, tripType, fields);
      } catch (error) {
        if (!(error instanceof NoCargoRecipientsException)) throw error;
      }
    }
    const willAnnounce = announce && driverIds.length > 0;
    // the profile's name (or none) becomes the name for this kind of load; a name typed for this load stays
    const typedName = fields.companyName?.trim();
    const companyName = !typedName || typedName === contact.company?.name ? companyNameFor(contact, tripType) : typedName;
    const listing = await this.saveListing(
      this.listings.create({
        ...fields,
        companyName,
        tripType,
        text: buildCargoListingText({ ...fields, companyName, tripType }),
        sourceMessageId,
        sourceNotificationId,
        publisherUserId: userId,
        companyId: contact.company?.id ?? null,
        status: CargoListingStatus.Open,
        announcedAt: willAnnounce ? new Date() : null,
      }),
    );
    if (!willAnnounce) {
      // stays out of «بارهای من» and is listed under «بارهای من که اعلام نشده‌اند» (unannounced) until announced
      await this.announceChange(listing);
      const { nextRunAt } = await this.announceSettings.get(userId);
      return {
        ...this.toView(listing), recipients: 0, pending: true,
        pendingReason: announce ? 'noDrivers' as const : 'automatic' as const,
        message: announce ? 'بار ثبت شد، اما به‌دلیل نبود راننده مناسب اعلام نشد؛ در «پیشنهادها» زیر «بارهای من که اعلام نشده‌اند» است.' : undefined,
        nextAnnounceAt: nextRunAt,
      };
    }
    await this.announceChange(listing);
    const recipients = await this.sendToDrivers(listing, driverIds, pushBatch);
    return { ...this.toView(listing), recipients, pending: false, nextAnnounceAt: null };
  }

  /** اعلان بار به راننده‌های همان نوع (داخلی/صادراتی/وارداتی) که فیلترشان جور است. */
  private async announcementRecipients(userId: string, tripType: CargoTripType, fields: CargoListingFields): Promise<string[]> {
    const drivers = (await this.audience.findDriverIds(await this.policy.getDriverRule(), tripType, userId)).filter(
      (id) => id !== userId,
    );
    const recipients = await this.filters.filterInterestedUsers(drivers, fields);
    if (!recipients.length) throw new NoCargoRecipientsException();
    return recipients;
  }

  /** pushBatch: the phone notification waits for the end of the auto-announce turn (one per driver). */
  private async sendToDrivers(listing: CargoListing, recipients: string[], pushBatch?: PushBatch): Promise<number> {

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

    if (pushBatch) {
      for (const row of rows) pushBatch.set(row.userId, [...(pushBatch.get(row.userId) ?? []), listing]);
    }

    // تلگرام/واتساپ برای تعداد زیاد راننده زمان می‌برد؛ درخواست شرکت منتظر نمی‌ماند.
    void this.dispatch(listing, rows, !pushBatch);

    this.logger.log(`Listing ${listing.id} (${listing.tripType}) announced to ${rows.length} driver(s)`);
    return rows.length;
  }

  private async dispatch(listing: CargoListing, rows: CargoNotification[], push: boolean): Promise<void> {
    // phone notification of the installed app, even while it is closed; quick, so before the messengers
    if (push) await Promise.all(rows.map((row) => this.pushLoads(row.userId, [listing])));
    try {
      for (const row of rows) {
        await this.delivery.deliver(row);
      }
    } catch (error) {
      this.logger.error(`Dispatching listing ${listing.id} failed; the retry worker will resume it`, (error as Error).stack);
    }
  }

  private async sendPushBatch(pushBatch: PushBatch): Promise<void> {
    await Promise.all([...pushBatch].map(([userId, listings]) => this.pushLoads(userId, listings)));
  }

  /** One phone notification for one load, or a summary for several («۱۰ بار تازه»). */
  private async pushLoads(userId: string, listings: CargoListing[]): Promise<void> {
    if (!listings.length) return;
    const fa = (value: number) => value.toLocaleString('fa-IR');
    const routes = listings.slice(0, 2).map((listing) => `${listing.origin} ← ${listing.destination}`).join('، ');
    const more = listings.length > 2 ? ` و ${fa(listings.length - 2)} بار دیگر` : '';
    const companies = [...new Set(listings.map((listing) => listing.companyName).filter(Boolean))];
    const company = companies.length === 1 ? ` · ${companies[0]}` : '';
    const message = {
      title: listings.length === 1 ? 'ترابوت · بار تازه' : `ترابوت · ${fa(listings.length)} بار تازه`,
      body: `📦 ${routes}${more}${company}`,
      url: '/account/driver/loads',
    };
    await this.push.sendToUser(userId, message).catch((error: Error) => this.logger.warn(`Cargo web push to ${userId} failed: ${error.message}`));
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
    // بار تحویل‌شده کارش تمام است؛ باز کردنش یعنی اعلام دوباره‌ی باری که دیگر وجود ندارد
    if (status === CargoListingStatus.Open && (await this.requests.hasDelivered(listing.id))) {
      throw new ConflictException('delivered');
    }

    if (!(await this.listings.changeStatus(listing.id, status))) {
      return this.toView(listing);
    }

    const updated = (await this.listings.findOneForPublisher(listingId, userId))!;
    await this.propagateStatus(updated);
    return this.toView(updated);
  }

  /**
   * بارهای خود شرکت؛ با search فقط آن‌هایی که با مبدأ/مقصد/نوع بار/ماشین گفته‌شده جورند. announcedOnly: فقط
   * بارهای اعلام‌شده («بارهای من»)؛ بار اعلام‌نشده (راننده‌ی مناسب نبود، یا در صف اعلام خودکار) در پیشنهادهاست.
   */
  async listMine(
    userId: string,
    options: { status?: CargoListingStatus; stage?: ListingStage; page: number; pageSize: number; announcedOnly?: boolean } & CargoSearch,
  ) {
    const skip = (options.page - 1) * options.pageSize;
    const search = prepareCargoSearch(options);
    let items: CargoListing[];
    let total: number;
    if (!search) {
      [items, total] = await this.listings.findPageForPublisher(userId, {
        status: options.status,
        stage: options.stage,
        skip,
        take: options.pageSize,
        announcedOnly: options.announcedOnly,
      });
    } else {
      const [recent] = await this.listings.findPageForPublisher(userId, {
        status: options.status,
        stage: options.stage,
        skip: 0,
        take: OPEN_SCAN_LIMIT,
        announcedOnly: options.announcedOnly,
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
  /** tripTypes: فقط بارهای این نوع‌ها (فهرست بار راننده، مثل اعلام بار فقط به راننده‌های همان نوع)؛ tripType جستجو یکی از آن‌ها. */
  // publisherUserIds: فقط بار این شرکت‌ها (واسط، BrokerAccessService.visiblePublishers)؛ نیامده = همه
  async listOpen(options: { page: number; pageSize: number; userId?: string; tripTypes?: CargoTripType[]; publisherUserIds?: string[] | null } & CargoSearch) {
    const skip = (options.page - 1) * options.pageSize;
    if (options.publisherUserIds?.length === 0) return { items: [], total: 0, page: options.page, pageSize: options.pageSize };
    const publishers = options.publisherUserIds ? { publisherUserIds: options.publisherUserIds } : {};
    const tripType = parseTripType(options.tripType) ?? undefined;
    const filters = options.userId ? await this.filters.activeFor(options.userId) : [];
    // جستجوی مبدأ/مقصد/نوع بار/ماشین («شامل بودن» مثل فیلترها)؛ بار برگشتی هم از همین استفاده می‌کند
    const search = prepareCargoSearch(options);
    let items: CargoListing[];
    let total: number;
    if (filters.length === 0 && !search) {
      [items, total] = await this.listings.findOpenPage({ skip, take: options.pageSize, tripType, ...(options.tripTypes && { tripTypes: options.tripTypes }), ...publishers });
    } else {
      const [recent] = await this.listings.findOpenPage({ skip: 0, take: OPEN_SCAN_LIMIT, tripType, ...(options.tripTypes && { tripTypes: options.tripTypes }), ...publishers });
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
      await this.editSent(row, text, taken ? TAKEN_REACTION : '');
    }

    this.logger.log(`Listing ${listing.id} is now ${listing.status}; updated ${rows.length} driver notification(s)`);
  }

  /**
   * The messages already sent to one driver get this text. A WhatsApp message past its edit window cannot change:
   * it gets `reaction` instead when there is one (❌ for a taken load).
   */
  private async editSent(row: CargoNotification, text: string, reaction?: string): Promise<void> {
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
      if (canEdit) await this.tryUpdate('WhatsApp update', row, () => this.whatsapp.editNotification(key, whatsappCards(text)));
      else if (reaction !== undefined) await this.tryUpdate('WhatsApp update', row, () => this.whatsapp.reactToNotification(key, reaction));
    }
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
      // the company's own photo; the picture of the load (photo or one of its kind) is /api/cargo-images/listing/:id
      hasPhoto: !!listing.photo,
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
