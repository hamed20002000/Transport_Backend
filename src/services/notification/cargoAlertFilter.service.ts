import { Injectable, NotFoundException } from '@nestjs/common';
import { CargoAlertFilter } from '../../domain/entities/notification/CargoAlertFilter';
import { normalizePersianText } from '../../domain/helper/persianText';
import { CargoAlertFilterRepository } from '../../infrastructure/repositories/notification/cargoAlertFilter.repository';

/** فیلدهایی از بار که فیلترها روی آن‌ها match می‌شوند. */
export interface CargoRouteFields {
  origin?: string | null;
  destination?: string | null;
  cargoType?: string | null;
  vehicleType?: string | null;
}

export interface CargoAlertFilterInput {
  label?: string | null;
  origins?: string[];
  destinations?: string[];
  cargoTypes?: string[];
  vehicleTypes?: string[];
  isActive?: boolean;
}

@Injectable()
export class CargoAlertFilterService {
  constructor(private readonly filters: CargoAlertFilterRepository) {}

  /**
   * از بین کاربرها، آن‌هایی که این بار را می‌خواهند. کاربری که هیچ فیلتر فعالی
   * ندارد همه‌ی بارها را می‌گیرد؛ در غیر این صورت کافی است یکی از فیلترهایش
   * match شود. برای شرکت‌ها و راننده‌ها یکسان است.
   */
  async filterInterestedUsers(userIds: string[], cargo: CargoRouteFields): Promise<string[]> {
    const filters = await this.filters.findActiveByUserIds(userIds);

    const byUser = new Map<string, CargoAlertFilter[]>();
    for (const filter of filters) {
      byUser.set(filter.userId, [...(byUser.get(filter.userId) ?? []), filter]);
    }

    return userIds.filter((userId) => {
      const userFilters = byUser.get(userId);
      return !userFilters || userFilters.some((filter) => this.isMatch(filter, cargo));
    });
  }

  isMatch(filter: CargoAlertFilter, cargo: CargoRouteFields): boolean {
    return (
      this.fieldMatches(filter.origins, cargo.origin) &&
      this.fieldMatches(filter.destinations, cargo.destination) &&
      this.fieldMatches(filter.cargoTypes, cargo.cargoType) &&
      this.fieldMatches(filter.vehicleTypes, cargo.vehicleType)
    );
  }

  // فیلتر خالی = همه. اگر کاربر فیلتر گذاشته ولی مدل آن فیلد را استخراج نکرده،
  // match حساب نمی‌شود. مقایسه «شامل بودن» است چون خروجی مدل متن آزاد است
  // (مثلاً «تهران - میدان آزادی» باید با فیلتر «تهران» match شود).
  private fieldMatches(filters: string[] | undefined, value: string | null | undefined): boolean {
    const normalizedFilters = (filters ?? []).map(normalizePersianText).filter((f) => f.length > 0);
    if (normalizedFilters.length === 0) return true;
    if (!value) return false;

    const normalizedValue = normalizePersianText(value);
    return normalizedFilters.some((f) => normalizedValue.includes(f));
  }

  list(userId: string): Promise<CargoAlertFilter[]> {
    return this.filters.findByUserId(userId);
  }

  create(userId: string, input: CargoAlertFilterInput): Promise<CargoAlertFilter> {
    return this.filters.save(this.filters.create({ ...this.clean(input), userId }));
  }

  async update(userId: string, id: string, input: CargoAlertFilterInput): Promise<CargoAlertFilter> {
    const filter = await this.getOwned(userId, id);
    return this.filters.save(Object.assign(filter, this.clean(input)));
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.filters.remove(await this.getOwned(userId, id));
  }

  private async getOwned(userId: string, id: string): Promise<CargoAlertFilter> {
    const filter = await this.filters.findOneForUser(id, userId);
    if (!filter) throw new NotFoundException('Cargo alert filter not found.');
    return filter;
  }

  private clean(input: CargoAlertFilterInput): CargoAlertFilterInput {
    const list = (values?: string[]) =>
      values === undefined ? undefined : [...new Set(values.map((v) => v.trim()).filter(Boolean))];

    const cleaned: CargoAlertFilterInput = {
      label: input.label === undefined ? undefined : input.label?.trim() || null,
      origins: list(input.origins),
      destinations: list(input.destinations),
      cargoTypes: list(input.cargoTypes),
      vehicleTypes: list(input.vehicleTypes),
      isActive: input.isActive,
    };

    // فیلدهایی که در درخواست نیامده‌اند نباید مقدار فعلی را پاک کنند.
    return Object.fromEntries(
      Object.entries(cleaned).filter(([, value]) => value !== undefined),
    ) as CargoAlertFilterInput;
  }
}
