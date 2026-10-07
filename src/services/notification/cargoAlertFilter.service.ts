import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CargoAlertFilter } from '../../domain/entities/notification/CargoAlertFilter';
import { normalizePersianText } from '../../domain/helper/persianText';
import { parsePriceToman } from '../../domain/helper/price';
import { CargoAlertFilterRepository } from '../../infrastructure/repositories/notification/cargoAlertFilter.repository';

/** فیلدهایی از بار که فیلترها روی آن‌ها match می‌شوند. */
export interface CargoRouteFields {
  origin?: string | null;
  destination?: string | null;
  cargoType?: string | null;
  vehicleType?: string | null;
  price?: string | null;
  // فقط بارهایی که شرکتی اعلام کرده نام شرکت دارند؛ بار خام کانال‌ها ندارد.
  companyName?: string | null;
}

export interface CargoAlertFilterInput {
  label?: string | null;
  origins?: string[];
  destinations?: string[];
  cargoTypes?: string[];
  vehicleTypes?: string[];
  companies?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
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

    return userIds.filter((userId) => this.matchesAny(byUser.get(userId) ?? [], cargo));
  }

  /** فیلترهای فعال یک کاربر؛ خالی یعنی همه‌ی بارها را می‌خواهد. */
  activeFor(userId: string): Promise<CargoAlertFilter[]> {
    return this.filters.findActiveByUserIds([userId]);
  }

  matchesAny(filters: CargoAlertFilter[], cargo: CargoRouteFields): boolean {
    return filters.length === 0 || filters.some((filter) => this.isMatch(filter, cargo));
  }

  isMatch(filter: CargoAlertFilter, cargo: CargoRouteFields): boolean {
    return (
      this.fieldMatches(filter.origins, cargo.origin) &&
      this.fieldMatches(filter.destinations, cargo.destination) &&
      this.fieldMatches(filter.cargoTypes, cargo.cargoType) &&
      this.fieldMatches(filter.vehicleTypes, cargo.vehicleType) &&
      this.fieldMatches(filter.companies, cargo.companyName) &&
      this.priceMatches(filter.minPrice, filter.maxPrice, cargo.price)
    );
  }

  // بدون حد = همه. مثل بقیه‌ی فیلدها، باری که کرایه‌اش استخراج یا خوانده نشده
  // با فیلتری که بازه دارد match نمی‌شود.
  private priceMatches(min: number | null | undefined, max: number | null | undefined, price: string | null | undefined): boolean {
    if (min == null && max == null) return true;
    const amount = parsePriceToman(price);
    if (amount === null) return false;
    return (min == null || amount >= min) && (max == null || amount <= max);
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
    const cleaned = this.clean(input);
    this.checkPriceRange(cleaned);
    return this.filters.save(this.filters.create({ ...cleaned, userId }));
  }

  private checkPriceRange({ minPrice, maxPrice }: Pick<CargoAlertFilterInput, 'minPrice' | 'maxPrice'>) {
    if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
      throw new BadRequestException('minPrice must not be greater than maxPrice.');
    }
  }

  async update(userId: string, id: string, input: CargoAlertFilterInput): Promise<CargoAlertFilter> {
    const filter = await this.getOwned(userId, id);
    const next = Object.assign(filter, this.clean(input));
    this.checkPriceRange(next);
    return this.filters.save(next);
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
      companies: list(input.companies),
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      isActive: input.isActive,
    };

    // فیلدهایی که در درخواست نیامده‌اند نباید مقدار فعلی را پاک کنند.
    return Object.fromEntries(
      Object.entries(cleaned).filter(([, value]) => value !== undefined),
    ) as CargoAlertFilterInput;
  }
}
