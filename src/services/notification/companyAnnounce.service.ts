import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import { CompanyAnnounceSetting } from '../../domain/entities/notification/CompanyAnnounceSetting';
import { CargoAnnounceMode } from '../../domain/enums/notification';

export const ANNOUNCE_INTERVALS = { min: 15, max: 24 * 60 };

export interface AnnounceSettingView {
  mode: CargoAnnounceMode;
  intervalMinutes: number;
  /** نوبت بعدی اعلام خودکار؛ در حالت دستی null */
  nextRunAt: Date | null;
  lastRunAt: Date | null;
}

/** حالت اعلام بار شرکت (دستی یا خودکار هر چند دقیقه) و نوبت بعدی اعلام خودکار. */
@Injectable()
export class CompanyAnnounceService {
  constructor(@InjectRepository(CompanyAnnounceSetting) private readonly settings: Repository<CompanyAnnounceSetting>) {}

  async get(userId: string): Promise<AnnounceSettingView> {
    return this.toView((await this.settings.findOne({ where: { userId } })) ?? this.settings.create({ userId }));
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
    return this.toView(await this.settings.save(setting));
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
    return { mode, intervalMinutes, nextRunAt, lastRunAt };
  }
}
