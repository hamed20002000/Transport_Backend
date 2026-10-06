import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { QueryFailedError } from 'typeorm';

import { CargoDetectedEvent } from '../../domain/constants/cargoEvents';
import { CargoListing } from '../../domain/entities/notification/CargoListing';
import { CargoNotification } from '../../domain/entities/notification/CargoNotification';
import { CargoListingStatus } from '../../domain/enums/notification';
import { CargoAudienceRepository } from '../../infrastructure/repositories/notification/cargoAudience.repository';
import { CargoListingRepository } from '../../infrastructure/repositories/notification/cargoListing.repository';
import { CargoNotificationRepository } from '../../infrastructure/repositories/notification/cargoNotification.repository';
import { WhatsappService } from '../../application/services/agent/services/whatsapp.service';
import { MessengerBotService } from '../messengerBot/core/messengerBot.service';
import { CargoAlertFilterService } from './cargoAlertFilter.service';
import { CargoNotificationService } from './cargoNotification.service';
import { SubscriptionPolicyService } from '../subscription/subscriptionPolicy.service';
import { buildCargoListingText, buildCargoTakenText, CargoListingFields } from './cargoNotificationText';
import {
  CARGO_NOTIFICATION_SOCKET_EVENT,
  CARGO_STATUS_SOCKET_EVENT,
  NotificationsGateway,
} from './notifications.gateway';

// واتساپ ویرایش را تا ۱۵ دقیقه قبول می‌کند؛ با کمی حاشیه‌ی اطمینان.
const WHATSAPP_EDIT_WINDOW_MS = 14 * 60 * 1000;

const TAKEN_REACTION = '❌';

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
    if (await this.listings.findBySourceAndPublisher(suggestion.sourceMessageId, userId)) {
      throw new ConflictException('You have already published this cargo.');
    }
    // رویدادهای قدیمی کد ندارند؛ آن‌ها مثل بار دستی کد می‌گیرند.
    const code = (suggestion.payload as Partial<CargoDetectedEvent>).code ?? await this.listings.nextManualCode();
    return this.publishListing(userId, { ...fields, code }, suggestion.sourceMessageId, suggestion.id);
  }

  /**
   * بار دستی که شرکت خودش ثبت می‌کند (از هیچ کانالی نیامده). شناسه‌ی منبع
   * یکتا ساخته می‌شود تا ایندکس (sourceMessageId, publisherUserId) و اعلان
   * راننده‌ها مثل بارهای منتشرشده از پیشنهاد کار کنند.
   */
  async createManual(userId: string, fields: CargoListingFields) {
    const code = await this.listings.nextManualCode();
    return this.publishListing(userId, { ...fields, code }, `manual:${randomUUID()}`, null);
  }

  private async publishListing(
    userId: string,
    fields: CargoListingFields & { code: string },
    sourceMessageId: string,
    sourceNotificationId: string | null,
  ) {
    const contact = await this.audience.findPublisherContact(userId);
    const listing = await this.saveListing(
      this.listings.create({
        ...fields,
        text: buildCargoListingText(fields),
        sourceMessageId,
        sourceNotificationId,
        publisherUserId: userId,
        companyId: contact.company?.id ?? null,
        status: CargoListingStatus.Open,
      }),
    );

    const drivers = (await this.audience.findDriverIds(await this.policy.isRequired())).filter((id) => id !== userId);
    const recipients = await this.filters.filterInterestedUsers(drivers, listing);

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

    const rows = await this.notifications.findByListing(listing.id);
    for (const row of rows) {
      this.gateway.sendToUser(row.userId, CARGO_NOTIFICATION_SOCKET_EVENT, this.delivery.toView(row));
    }

    // تلگرام/واتساپ برای تعداد زیاد راننده زمان می‌برد؛ درخواست شرکت منتظر نمی‌ماند.
    void this.dispatch(listing, rows);

    this.logger.log(`User ${userId} published cargo ${listing.sourceMessageId} as listing ${listing.id} to ${rows.length} driver(s)`);
    return { ...this.toView(listing), recipients: rows.length };
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
  async setStatus(userId: string, listingId: string, status: CargoListingStatus) {
    const listing = await this.listings.findOneForPublisher(listingId, userId);
    if (!listing) throw new NotFoundException('Cargo listing not found.');

    if (!(await this.listings.changeStatus(listing.id, status))) {
      return this.toView(listing);
    }

    const updated = (await this.listings.findOneForPublisher(listingId, userId))!;
    await this.propagateStatus(updated);
    return this.toView(updated);
  }

  async listMine(userId: string, options: { status?: CargoListingStatus; page: number; pageSize: number }) {
    const [items, total] = await this.listings.findPageForPublisher(userId, {
      status: options.status,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    });

    return { items: items.map((listing) => this.toView(listing)), total, page: options.page, pageSize: options.pageSize };
  }

  /** بارهای باز همه‌ی شرکت‌ها برای راننده؛ متن هر بار همان پیامی است که برای راننده‌ها فرستاده شد. */
  async listOpen(options: { page: number; pageSize: number }) {
    const [items, total] = await this.listings.findOpenPage({
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    });

    return { items: items.map((listing) => this.toView(listing)), total, page: options.page, pageSize: options.pageSize };
  }

  private async propagateStatus(listing: CargoListing): Promise<void> {
    const taken = listing.status === CargoListingStatus.Taken;
    const rows = await this.notifications.findByListing(listing.id);

    for (const row of rows) {
      this.gateway.sendToUser(row.userId, CARGO_STATUS_SOCKET_EVENT, {
        id: row.id,
        listingId: listing.id,
        status: listing.status,
        takenAt: listing.takenAt ?? null,
      });

      const text = taken ? buildCargoTakenText(row.text) : row.text;

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
            ? this.whatsapp.editNotification(key, text)
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

  private toView(listing: CargoListing) {
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
      createdAt: listing.createdAt,
    };
  }
}
