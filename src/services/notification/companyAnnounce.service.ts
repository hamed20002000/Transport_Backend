import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import { CompanyAnnounceSetting } from '../../domain/entities/notification/CompanyAnnounceSetting';
import { CargoAnnounceMode } from '../../domain/enums/notification';
import { CargoListingRepository } from '../../infrastructure/repositories/notification/cargoListing.repository';

export const ANNOUNCE_INTERVALS = { min: 15, max: 24 * 60 };

export interface AnnounceSettingView {
  mode: CargoAnnounceMode;
  intervalMinutes: number;
  /** نوبت بعدی اعلام خودکار؛ در حالت دستی null */
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  /** بارهای اعلام‌شده در آخرین نوبت خودکار؛ تا نوبت اول (و در حالت دستی) null */
  lastRunAnnounced: number | null;
}

// یک نوبت چند ثانیه طول می‌کشد؛ اعلام‌های این بازه بعد از lastRunAt مال همان نوبت‌اند
const RUN_WINDOW_MS = 5 * 60_000;

/** حالت اعلام بار شرکت (دستی یا خودکار هر چند دقیقه) و نوبت بعدی اعلام خودکار. */
@Injectable()
export class CompanyAnnounceService {
  constructor(
    @InjectRepository(CompanyAnnounceSetting) private readonly settings: Repository<CompanyAnnounceSetting>,
    private readonly listings: CargoListingRepository,
  ) {}

  async get(userId: string): Promise<AnnounceSettingView> {
    const setting = (await this.settings.findOne({ where: { userId } })) ?? this.settings.create({ userId });
    const view = this.toView(setting);
    // روشن کردن خودکار lastRunAt را همان autoSince می‌گذارد؛ یعنی هنوز نوبتی اجرا نشده
    const ran = view.mode === CargoAnnounceMode.Auto && setting.lastRunAt && setting.autoSince
      && setting.lastRunAt.getTime() - setting.autoSince.getTime() > 1000;
    if (ran) {
      const from = setting.lastRunAt!;
      view.lastRunAnnounced = await this.listings.countAnnouncedBetween(userId, from, new Date(from.getTime() + RUN_WINDOW_MS));
    }
    return view;
  }

  async isAuto(userId: string): Promise<boolean> {
    return (await this.get(userId)).mode === CargoAnnounceMode.Auto;
  }

  /** روشن کردن خودکار: از همین الان پیشنهادها حساب می‌شوند و نوبت اول بعد از یک بازه است. */
  async set(userId: string, mode: CargoAnnounceMode, intervalMinutes?: number): Promise<AnnounceSettingView> {
    const setting = (await this.settings.findOne({ where: { userId } })) ?? this.settings.create({ userId });
    if (intervalMinutes !== undefined) {
      if (!Number.isInteger(intervalMinutes) || intervalMinutes < ANNOUNCE_INTERVALS.min || intervalMinutes > ANNOUNCE_INTERVALS.max) {
        throw new BadRequestException(`intervalMinutes must be between ${ANNOUNCE_INTERVALS.min} and ${ANNOUNCE_INTERVALS.max}.`);
      }
      setting.intervalMinutes = intervalMinutes;
    }
    if (mode === CargoAnnounceMode.Auto && setting.mode !== CargoAnnounceMode.Auto) {
      setting.autoSince = new Date();
      setting.lastRunAt = new Date();
    }
    setting.mode = mode;
    await this.settings.save(setting);
    return this.get(userId);
  }

  /** شرکت‌هایی که نوبت اعلام خودکارشان رسیده است. */
  async due(now = new Date()): Promise<CompanyAnnounceSetting[]> {
    const auto = await this.settings.find({ where: { mode: CargoAnnounceMode.Auto, lastRunAt: LessThanOrEqual(now) } });
    return auto.filter((setting) => !setting.lastRunAt || setting.lastRunAt.getTime() + setting.intervalMinutes * 60_000 <= now.getTime());
  }

  async markRun(userId: string, at = new Date()): Promise<void> {
    await this.settings.update({ userId }, { lastRunAt: at });
  }

  private toView(setting: CompanyAnnounceSetting): AnnounceSettingView {
    const mode = setting.mode ?? CargoAnnounceMode.Manual;
    const intervalMinutes = setting.intervalMinutes ?? 120;
    const lastRunAt = setting.lastRunAt ?? null;
    const nextRunAt = mode === CargoAnnounceMode.Auto ? new Date((lastRunAt ?? new Date()).getTime() + intervalMinutes * 60_000) : null;
    return { mode, intervalMinutes, nextRunAt, lastRunAt, lastRunAnnounced: null };
  }
}
