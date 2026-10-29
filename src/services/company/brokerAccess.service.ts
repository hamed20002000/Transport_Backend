import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';

import { BrokerAccessOrder } from 'src/domain/entities/company/BrokerAccessOrder';
import { BrokerAccessPeriod } from 'src/domain/entities/company/BrokerAccessPeriod';
import { AppSetting } from 'src/domain/entities/setting/AppSetting';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { BROKER_ROLE, isBrokerOnly } from '../notification/loadRequesters';
import { RedisService } from '../redis/redis.service';
import { BrokerAccessOrderEvent, REDIS_CHANNELS } from '../redis/redis.keys';
import { CompanyFeatureService } from './companyFeature.service';

const DAY_MS = 86_400_000;
const SETTING_KEY = 'brokerAccessPolicy';
// a policy change reaches every instance within this (no restart, no pub/sub needed for a price)
const LOCAL_TTL_MS = 5_000;

/**
 * خرید واسط برای دیدن بار شرکت‌ها: تا includedCompanies شرکت basePrice، و هر شرکت بیشتر extraCompanyPrice، برای
 * durationDays روز. enabled خاموش = واسط بار همه‌ی شرکت‌ها را بی‌خرید می‌بیند (مثل قبل).
 */
export interface BrokerAccessPolicy {
  enabled: boolean;
  includedCompanies: number;
  basePrice: string;
  extraCompanyPrice: string;
  durationDays: number;
  currency: string;
}

const DEFAULT_POLICY: BrokerAccessPolicy = {
  enabled: false,
  includedCompanies: 4,
  basePrice: '0',
  extraCompanyPrice: '0',
  durationDays: 30,
  currency: 'IRR',
};

/** قیمت دوره‌ی تازه با count شرکت. */
export function newPeriodPrice(policy: BrokerAccessPolicy, count: number): string {
  const extra = Math.max(0, count - policy.includedCompanies);
  return (BigInt(policy.basePrice) + BigInt(extra) * BigInt(policy.extraCompanyPrice)).toString();
}

/** قیمت افزودن adding شرکت به دوره‌ای که existing شرکت دارد: جای خالی سهمیه رایگان، بقیه هر کدام extraCompanyPrice. */
export function addCompaniesPrice(policy: BrokerAccessPolicy, existing: number, adding: number): string {
  const paidBefore = Math.max(0, existing - policy.includedCompanies);
  const paidAfter = Math.max(0, existing + adding - policy.includedCompanies);
  return (BigInt(paidAfter - paidBefore) * BigInt(policy.extraCompanyPrice)).toString();
}

const companyView = (company: { userId: string; name: string | null; accountCode: string | null }) => ({
  userId: company.userId,
  name: company.name || company.accountCode || '—',
});

export interface BrokerOrderInput {
  kind: 'NEW' | 'ADD';
  companyUserIds: string[];
}

/**
 * دسترسی واسط به بار شرکت‌ها؛ یک جواب برای پنل وب، ربات‌ها، واتساپ و دستیار. واسط هر بار شرکت‌هایی را که بارشان را
 * می‌خواهد انتخاب می‌کند و با فیش کارت‌به‌کارت می‌خرد؛ ادمین تأیید می‌کند. وسط دوره شرکت تازه هم اضافه می‌شود.
 */
@Injectable()
export class BrokerAccessService {
  private cached?: { policy: BrokerAccessPolicy; expiresAt: number };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AppSetting) private readonly settings: Repository<AppSetting>,
    @InjectRepository(BrokerAccessOrder) private readonly orders: Repository<BrokerAccessOrder>,
    @InjectRepository(BrokerAccessPeriod) private readonly periods: Repository<BrokerAccessPeriod>,
    private readonly companies: CompanyFeatureService,
    private readonly redis: RedisService,
  ) {}

  //#region ----------- Policy ---------------------------------------------------

  async getPolicy(): Promise<BrokerAccessPolicy> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.policy;
    const row = await this.settings.findOne({ where: { key: SETTING_KEY } });
    const policy = { ...DEFAULT_POLICY, ...(row?.value as Partial<BrokerAccessPolicy> | undefined) };
    this.cached = { policy, expiresAt: Date.now() + LOCAL_TTL_MS };
    return policy;
  }

  async setPolicy(policy: BrokerAccessPolicy, adminUserId: string): Promise<BrokerAccessPolicy> {
    await this.settings.save({ key: SETTING_KEY, value: { ...policy }, updatedByUserId: adminUserId });
    this.cached = undefined;
    return this.getPolicy();
  }

  //#endregion

  //#region ----------- Access ---------------------------------------------------

  /**
   * شرکت‌هایی (User.id) که بارشان برای این کاربر دیده می‌شود؛ null یعنی محدودیتی نیست (راننده، یا خرید واسط خاموش).
   * واسط بی‌دوره‌ی باز فهرست خالی می‌گیرد.
   */
  async visiblePublishers(userId: string, now = new Date()): Promise<string[] | null> {
    if (!(await this.getPolicy()).enabled || !(await this.isBroker(userId))) return null;
    return (await this.currentPeriod(userId, now))?.companyUserIds ?? [];
  }

  async canSee(userId: string, publisherUserId: string, now = new Date()): Promise<boolean> {
    const visible = await this.visiblePublishers(userId, now);
    return !visible || visible.includes(publisherUserId);
  }

  /** The broker may work now: the purchase is off, or it has a period open. */
  async hasOpenAccess(userId: string, now = new Date()): Promise<boolean> {
    return !(await this.getPolicy()).enabled || !!(await this.currentPeriod(userId, now));
  }

  async isBroker(userId: string): Promise<boolean> {
    const rows: Array<{ name: string }> = await this.dataSource.query(
      `SELECT r.name FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" AND r."recordStatus" = $2 WHERE ur."userId" = $1`,
      [userId, RecordStatus.Active],
    );
    return isBrokerOnly(rows.map((row) => row.name));
  }

  /** دوره‌ای که الان باز است (دوره‌ی تمدیدی که هنوز شروع نشده نه). */
  private currentPeriod(userId: string, now: Date): Promise<BrokerAccessPeriod | null> {
    return this.periods.findOne({ where: { userId, startAt: LessThanOrEqual(now), expireAt: MoreThan(now) }, order: { startAt: 'DESC' } });
  }

  /** وضعیت برای صفحه‌ی خرید: قیمت‌ها، دوره‌ی باز و تمدیدی، شرکت‌های قابل انتخاب و آخرین خریدها. */
  async status(userId: string, now = new Date()) {
    const [policy, companies, names, periods, latestOrders] = await Promise.all([
      this.getPolicy(),
      this.companyList(),
      this.companyNames(),
      this.periods.find({ where: { userId, expireAt: MoreThan(now) }, order: { startAt: 'ASC' } }),
      this.orders.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    const view = (period: BrokerAccessPeriod) => ({
      id: period.id,
      startAt: period.startAt,
      expireAt: period.expireAt,
      companies: period.companyUserIds.map((id) => ({ userId: id, name: names.get(id) ?? '—' })),
    });
    const current = periods.find((period) => period.startAt <= now) ?? null;
    const next = periods.find((period) => period.startAt > now) ?? null;
    return {
      policy,
      period: current && view(current),
      next: next && view(next),
      companies,
      orders: latestOrders.map((order) => this.orderView(order, names)),
    };
  }

  /** واسط‌های فعال برای صفحه‌ی ادمین، با پایان دوره‌ی باز و شمار شرکت‌هایش. */
  async listBrokers(now = new Date()) {
    const rows: Array<{ userId: string; name: string | null; mobile: string | null; accountCode: string | null; expireAt: Date | null; companies: number | null }> =
      await this.dataSource.query(
        `SELECT u.id AS "userId",
           COALESCE(NULLIF(u."companyName", ''), NULLIF(concat_ws(' ', u."firstName", u."lastName"), ''), u.username) AS name,
           u.mobile, u."accountCode", p."expireAt", cardinality(p."companyUserIds") AS companies
         FROM "User" u
         LEFT JOIN LATERAL (
           SELECT "expireAt", "companyUserIds" FROM "BrokerAccessPeriod"
           WHERE "userId" = u.id AND "startAt" <= $3 AND "expireAt" > $3 ORDER BY "startAt" DESC LIMIT 1
         ) p ON true
         WHERE u."recordStatus" = $1 AND EXISTS (
           SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
           WHERE ur."userId" = u.id AND r."recordStatus" = $1 AND r.name = $2
         )
         ORDER BY name`,
        [RecordStatus.Active, BROKER_ROLE, now],
      );
    return rows.map((row) => ({ ...row, companies: row.companies ?? 0 }));
  }

  /**
   * شرکت‌هایی که واسط می‌تواند انتخاب کند: شرکت مادر و شرکت‌های زیر آن (دعوت‌شده یا تأییدشده‌ی شرکت مادر)؛ شرکت
   * خودثبت‌نام‌کرده‌ای که هنوز تأیید نشده نه.
   */
  async companyList(): Promise<Array<{ userId: string; name: string }>> {
    const companies = await this.companies.listCompanies();
    const parents = new Set(companies.filter((company) => company.isParentCompany).map((company) => company.userId));
    return companies
      .filter((company) => company.isParentCompany || (company.invitedByCompanyUserId && parents.has(company.invitedByCompanyUserId)))
      .map(companyView);
  }

  /** نام همه‌ی شرکت‌ها، برای دوره‌ها و سفارش‌هایی که شرکتشان دیگر در فهرست انتخاب نیست. */
  private async companyNames(): Promise<Map<string, string>> {
    return new Map((await this.companies.listCompanies()).map((company) => [company.userId, companyView(company).name]));
  }

  //#endregion

  //#region ----------- Orders ---------------------------------------------------

  /** مبلغ سفارش؛ ADD فقط شرکت‌هایی را حساب می‌کند که هنوز در دوره‌ی باز نیستند. */
  async quote(userId: string, input: BrokerOrderInput, now = new Date()) {
    const policy = await this.getPolicy();
    if (!policy.enabled) throw new BadRequestException('دیدن بار شرکت‌ها الان خرید لازم ندارد.');
    const ids = [...new Set(input.companyUserIds)];
    if (!ids.length) throw new BadRequestException('دست‌کم یک شرکت انتخاب کنید.');
    const known = new Set((await this.companyList()).map((company) => company.userId));
    if (ids.some((id) => !known.has(id))) throw new BadRequestException('یکی از شرکت‌های انتخاب‌شده پیدا نشد.');
    if (input.kind === 'NEW') return { policy, period: null, companyUserIds: ids, amount: newPeriodPrice(policy, ids.length) };

    const period = await this.currentPeriod(userId, now);
    if (!period) throw new BadRequestException('دوره‌ی بازی ندارید؛ اول شرکت‌ها را بخرید.');
    const adding = ids.filter((id) => !period.companyUserIds.includes(id));
    if (!adding.length) throw new BadRequestException('این شرکت‌ها از قبل در دوره‌ی شما هستند.');
    return { policy, period, companyUserIds: adding, amount: addCompaniesPrice(policy, period.companyUserIds.length, adding.length) };
  }

  /**
   * خرید با فیش؛ افزودنی که در سهمیه جا می‌شود (مبلغ صفر) بی‌فیش همان لحظه اضافه می‌شود.
   * receiptPath فقط برای مبلغ غیرصفر لازم است.
   */
  async submitOrder(userId: string, input: BrokerOrderInput, receiptPath: string | null, now = new Date()) {
    const { policy, period, companyUserIds, amount } = await this.quote(userId, input, now);
    if (period && amount === '0') {
      await this.periods.update({ id: period.id }, { companyUserIds: [...period.companyUserIds, ...companyUserIds] });
      return { added: companyUserIds.length, order: null };
    }
    if (!receiptPath) throw new BadRequestException('عکس رسید پرداخت را بفرستید.');
    const open = await this.orders.findOne({ where: { userId, status: SubscriptionOrderStatus.ReceiptSubmitted } });
    if (open) throw new ConflictException('رسید قبلی شما در حال بررسی است.');
    const order = await this.orders.save(
      this.orders.create({
        userId,
        kind: input.kind,
        periodId: period?.id ?? null,
        companyUserIds,
        durationDays: policy.durationDays,
        amount,
        currency: policy.currency,
        status: SubscriptionOrderStatus.ReceiptSubmitted,
        receiptPath,
      }),
    );
    await this.announce(REDIS_CHANNELS.brokerAccessReceipt, order);
    return { added: 0, order: this.orderView(order) };
  }

  async listOrders(statuses: SubscriptionOrderStatus[]) {
    const [orders, names] = await Promise.all([
      this.orders.find({ where: { status: In(statuses) }, relations: { user: true }, order: { createdAt: 'DESC' }, take: 100 }),
      this.companyNames(),
    ]);
    return orders.map((order) => ({
      ...this.orderView(order, names),
      userId: order.userId,
      broker: order.user?.companyName || [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') || order.user?.username,
      mobile: order.user?.mobile ?? null,
      accountCode: order.user?.accountCode ?? null,
    }));
  }

  findOrder(id: string): Promise<BrokerAccessOrder | null> {
    return this.orders.findOne({ where: { id } });
  }

  /**
   * تأیید فیش: NEW دوره‌ی تازه بعد از پایان آخرین دوره‌ی باز (یا از الان)؛ ADD شرکت‌ها را به همان دوره اضافه می‌کند.
   */
  async approveOrder(orderId: string, adminUserId: string, now = new Date()) {
    const { order, period } = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(BrokerAccessOrder, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new NotFoundException('سفارش پیدا نشد.');
      if (order.status !== SubscriptionOrderStatus.ReceiptSubmitted) throw new ConflictException('این سفارش قبلاً بررسی شده است.');
      const periods = manager.getRepository(BrokerAccessPeriod);
      let period: BrokerAccessPeriod;
      if (order.kind === 'ADD') {
        const found = order.periodId ? await periods.findOne({ where: { id: order.periodId }, lock: { mode: 'pessimistic_write' } }) : null;
        if (!found) throw new NotFoundException('دوره‌ی این افزودن پیدا نشد.');
        found.companyUserIds = [...new Set([...found.companyUserIds, ...order.companyUserIds])];
        period = await periods.save(found);
      } else {
        const latest = await periods.findOne({ where: { userId: order.userId, expireAt: MoreThan(now) }, order: { expireAt: 'DESC' } });
        const startAt = latest ? latest.expireAt : now;
        period = await periods.save(
          periods.create({
            userId: order.userId,
            companyUserIds: order.companyUserIds,
            startAt,
            expireAt: new Date(startAt.getTime() + order.durationDays * DAY_MS),
            orderId: order.id,
          }),
        );
      }
      await manager.update(BrokerAccessOrder, { id: order.id }, { status: SubscriptionOrderStatus.Approved, reviewedBy: adminUserId, reviewedAt: now });
      return { order, period };
    });
    await this.announce(REDIS_CHANNELS.brokerAccessDecided, order, { approved: true, expireAt: period.expireAt.toISOString() });
    return { orderId: order.id, userId: order.userId, startAt: period.startAt, expireAt: period.expireAt };
  }

  /**
   * دسترسی بی‌خرید از طرف ادمین (هدیه یا جبران): NEW دوره‌ی days روزه بعد از پایان آخرین دوره‌ی باز (یا از الان)،
   * ADD شرکت‌ها را به دوره‌ی باز اضافه می‌کند. خاموش بودن خرید جلویش را نمی‌گیرد، تا با روشن شدن آماده باشد.
   */
  async grant(userId: string, input: BrokerOrderInput & { days: number }, adminUserId: string, now = new Date()) {
    if (!(await this.isBroker(userId))) throw new NotFoundException('واسطی با این شناسه پیدا نشد.');
    const ids = [...new Set(input.companyUserIds)];
    const known = new Set((await this.companyList()).map((company) => company.userId));
    if (!ids.length || ids.some((id) => !known.has(id))) throw new BadRequestException('یکی از شرکت‌های انتخاب‌شده پیدا نشد.');
    if (input.kind === 'ADD') {
      const period = await this.currentPeriod(userId, now);
      if (!period) throw new BadRequestException('این واسط دوره‌ی بازی ندارد؛ دوره‌ی تازه بدهید.');
      period.companyUserIds = [...new Set([...period.companyUserIds, ...ids])];
      const saved = await this.periods.save(period);
      return { periodId: saved.id, startAt: saved.startAt, expireAt: saved.expireAt };
    }
    const latest = await this.periods.findOne({ where: { userId, expireAt: MoreThan(now) }, order: { expireAt: 'DESC' } });
    const startAt = latest ? latest.expireAt : now;
    const saved = await this.periods.save(
      this.periods.create({ userId, companyUserIds: ids, startAt, expireAt: new Date(startAt.getTime() + input.days * DAY_MS), orderId: null, grantedBy: adminUserId }),
    );
    return { periodId: saved.id, startAt: saved.startAt, expireAt: saved.expireAt };
  }

  async rejectOrder(orderId: string, adminUserId: string, reason: string, now = new Date()) {
    const result = await this.orders.update(
      { id: orderId, status: SubscriptionOrderStatus.ReceiptSubmitted },
      { status: SubscriptionOrderStatus.Rejected, rejectionReason: reason, reviewedBy: adminUserId, reviewedAt: now },
    );
    if (!result.affected) throw new ConflictException('سفارشی در انتظار بررسی با این شناسه نیست.');
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (order) await this.announce(REDIS_CHANNELS.brokerAccessDecided, order, { approved: false, reason });
    return { orderId };
  }

  /** The admins (a new receipt) or the broker (a decision) hear of it through SubscriptionNotifier; failures are only logged. */
  private async announce(channel: string, order: BrokerAccessOrder, extra: Partial<BrokerAccessOrderEvent> = {}): Promise<void> {
    const event: BrokerAccessOrderEvent = {
      orderId: order.id,
      userId: order.userId,
      kind: order.kind,
      companies: order.companyUserIds.length,
      amount: order.amount,
      currency: order.currency,
      ...extra,
    };
    await this.redis.publish(channel, JSON.stringify(event)).catch(() => undefined);
  }

  private orderView(order: BrokerAccessOrder, names?: Map<string, string>) {
    return {
      id: order.id,
      kind: order.kind,
      companies: order.companyUserIds.map((id) => ({ userId: id, name: names?.get(id) ?? '—' })),
      durationDays: order.durationDays,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      rejectionReason: order.rejectionReason ?? null,
      createdAt: order.createdAt,
      reviewedAt: order.reviewedAt ?? null,
    };
  }

  //#endregion
}
