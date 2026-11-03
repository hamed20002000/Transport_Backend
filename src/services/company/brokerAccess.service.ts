import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';

import { BrokerAccessOrder, BrokerOrderKind } from 'src/domain/entities/company/BrokerAccessOrder';
import { BrokerAccessPeriod } from 'src/domain/entities/company/BrokerAccessPeriod';
import { BrokerRequestCredit } from 'src/domain/entities/company/BrokerRequestCredit';
import { AppSetting } from 'src/domain/entities/setting/AppSetting';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { BROKER_ROLE, isBrokerOnly } from '../notification/loadRequesters';
import { RedisService } from '../redis/redis.service';
import { BrokerAccessOrderEvent, REDIS_CHANNELS } from '../redis/redis.keys';
import { CompanyFeatureService } from './companyFeature.service';

const SETTING_KEY = 'brokerAccessPolicy';
// a policy change reaches every instance within this (no restart, no pub/sub needed for a price)
const LOCAL_TTL_MS = 5_000;
/** packages bought in one receipt at most */
export const MAX_PACKAGES = 100;

/**
 * قواعد واسط که ادمین تعیین می‌کند. maxCompanies: واسط خودش تا این تعداد شرکت انتخاب می‌کند و فقط بار همان‌ها را
 * می‌بیند؛ null یعنی بار همه‌ی شرکت‌ها. packagesEnabled: درخواست بار بسته‌ای خریده می‌شود، هر بسته packageSize
 * درخواست به packagePrice؛ خاموش یعنی درخواست رایگان.
 */
export interface BrokerAccessPolicy {
  maxCompanies: number | null;
  packagesEnabled: boolean;
  packageSize: number;
  packagePrice: string;
  currency: string;
}

const DEFAULT_POLICY: BrokerAccessPolicy = {
  maxCompanies: null,
  packagesEnabled: false,
  packageSize: 50,
  packagePrice: '0',
  currency: 'IRR',
};

/** «بسته‌ی ۱۰۰ درخواست بار», «خرید بار ۳ شرکت» (older orders): what an order bought, for notices and payments */
export function brokerOrderTitle(order: { kind: BrokerOrderKind; requests?: number | null; companies: number }): string {
  if (order.kind === 'PACKAGE') return `بسته‌ی ${Number(order.requests ?? 0).toLocaleString('fa-IR')} درخواست بار`;
  return `${order.kind === 'ADD' ? 'افزودن' : 'خرید'} بار ${order.companies.toLocaleString('fa-IR')} شرکت`;
}

const companyView = (company: { userId: string; name: string | null; accountCode: string | null }) => ({
  userId: company.userId,
  name: company.name || company.accountCode || '—',
});

/** Why a broker sees no loads: the admin limits the companies and it has picked none yet. */
export type BrokerBlock = 'noCompanies';

/**
 * دسترسی واسط به بار شرکت‌ها؛ یک جواب برای پنل وب، ربات‌ها، واتساپ و دستیار. شرکت‌ها را واسط خودش انتخاب می‌کند
 * (وقتی ادمین سقف گذاشته، تا همان سقف و فقط بار همان‌ها؛ بی‌سقف بار همه)، و درخواست بار را بسته‌ای با فیش
 * کارت‌به‌کارت و بررسی ادمین می‌خرد: هر درخواست یکی از مانده‌اش کم می‌کند.
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
    @InjectRepository(BrokerRequestCredit) private readonly credits: Repository<BrokerRequestCredit>,
  ) {}

  //#region ----------- Policy ---------------------------------------------------

  async getPolicy(): Promise<BrokerAccessPolicy> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.policy;
    const row = await this.settings.findOne({ where: { key: SETTING_KEY } });
    // the older purchase of companies (enabled, prices, days) is no longer kept
    const stored = (row?.value ?? {}) as Partial<BrokerAccessPolicy>;
    const policy: BrokerAccessPolicy = {
      maxCompanies: stored.maxCompanies ?? DEFAULT_POLICY.maxCompanies,
      packagesEnabled: stored.packagesEnabled ?? DEFAULT_POLICY.packagesEnabled,
      packageSize: stored.packageSize ?? DEFAULT_POLICY.packageSize,
      packagePrice: stored.packagePrice ?? DEFAULT_POLICY.packagePrice,
      currency: stored.currency ?? DEFAULT_POLICY.currency,
    };
    this.cached = { policy, expiresAt: Date.now() + LOCAL_TTL_MS };
    return policy;
  }

  async setPolicy(policy: BrokerAccessPolicy, adminUserId: string): Promise<BrokerAccessPolicy> {
    if (policy.packagesEnabled && BigInt(policy.packagePrice) <= 0n) throw new BadRequestException('قیمت بسته را وارد کنید.');
    const { maxCompanies, packagesEnabled, packageSize, packagePrice, currency } = policy;
    await this.settings.save({ key: SETTING_KEY, value: { maxCompanies, packagesEnabled, packageSize, packagePrice, currency }, updatedByUserId: adminUserId });
    this.cached = undefined;
    return this.getPolicy();
  }

  //#endregion

  //#region ----------- Access ---------------------------------------------------

  /**
   * شرکت‌هایی (User.id) که بارشان برای این کاربر دیده می‌شود؛ null یعنی همه (راننده، یا واسط وقتی ادمین سقف شرکت
   * نگذاشته). واسطی که هنوز شرکتی انتخاب نکرده فهرست خالی می‌گیرد.
   */
  async visiblePublishers(userId: string, now = new Date()): Promise<string[] | null> {
    if (!(await this.isBroker(userId)) || (await this.getPolicy()).maxCompanies === null) return null;
    return (await this.currentSelection(userId, now))?.companyUserIds ?? [];
  }

  async canSee(userId: string, publisherUserId: string, now = new Date()): Promise<boolean> {
    const visible = await this.visiblePublishers(userId, now);
    return !visible || visible.includes(publisherUserId);
  }

  /** The broker may work now: no company limit, or companies picked. */
  async hasOpenAccess(userId: string, now = new Date()): Promise<boolean> {
    return !(await this.blocked(userId, now));
  }

  /** What still keeps a broker from the loads, or null (also for anyone not a broker). */
  async blocked(userId: string, now = new Date()): Promise<BrokerBlock | null> {
    const visible = await this.visiblePublishers(userId, now);
    return visible && !visible.length ? 'noCompanies' : null;
  }

  async isBroker(userId: string): Promise<boolean> {
    const rows: Array<{ name: string }> = await this.dataSource.query(
      `SELECT r.name FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" AND r."recordStatus" = $2 WHERE ur."userId" = $1`,
      [userId, RecordStatus.Active],
    );
    return isBrokerOnly(rows.map((row) => row.name));
  }

  /** The companies picked: one row with no end (older purchases had one, still honoured until it). */
  private currentSelection(userId: string, now: Date, manager?: EntityManager): Promise<BrokerAccessPeriod | null> {
    return (manager?.getRepository(BrokerAccessPeriod) ?? this.periods).findOne({
      where: [
        { userId, startAt: LessThanOrEqual(now), expireAt: IsNull() },
        { userId, startAt: LessThanOrEqual(now), expireAt: MoreThan(now) },
      ],
      order: { startAt: 'DESC' },
    });
  }

  /** A broker whose packages are used up while requests are sold: its request buttons are shown off. */
  async outOfRequests(userId: string): Promise<boolean> {
    if (!(await this.getPolicy()).packagesEnabled || !(await this.isBroker(userId))) return false;
    return (await this.remaining(userId)) <= 0;
  }

  /** The broker's load requests left. */
  async remaining(userId: string): Promise<number> {
    return (await this.credits.findOne({ where: { userId } }))?.remaining ?? 0;
  }

  /** وضعیت برای صفحه‌ی خرید: قواعد، شرکت‌های انتخاب‌شده و قابل انتخاب، درخواست‌های مانده و آخرین خریدها. */
  async status(userId: string, now = new Date()) {
    const [policy, companies, names, selection, remaining, latestOrders] = await Promise.all([
      this.getPolicy(),
      this.companyList(),
      this.companyNames(),
      this.currentSelection(userId, now),
      this.remaining(userId),
      this.orders.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    return {
      policy,
      selected: (selection?.companyUserIds ?? []).map((id) => ({ userId: id, name: names.get(id) ?? '—' })),
      remaining,
      blocked: policy.maxCompanies !== null && !selection?.companyUserIds.length ? ('noCompanies' as const) : null,
      companies,
      orders: latestOrders.map((order) => this.orderView(order, names)),
    };
  }

  /** واسط‌های فعال برای صفحه‌ی ادمین، با شمار شرکت‌های انتخاب‌شده و درخواست‌های مانده. */
  async listBrokers(now = new Date()) {
    const rows: Array<{ userId: string; name: string | null; mobile: string | null; accountCode: string | null; companies: number | null; remaining: number | null }> =
      await this.dataSource.query(
        `SELECT u.id AS "userId",
           COALESCE(NULLIF(u."companyName", ''), NULLIF(concat_ws(' ', u."firstName", u."lastName"), ''), u.username) AS name,
           u.mobile, u."accountCode", cardinality(p."companyUserIds") AS companies, c.remaining
         FROM "User" u
         LEFT JOIN LATERAL (
           SELECT "companyUserIds" FROM "BrokerAccessPeriod"
           WHERE "userId" = u.id AND "startAt" <= $3 AND ("expireAt" IS NULL OR "expireAt" > $3) ORDER BY "startAt" DESC LIMIT 1
         ) p ON true
         LEFT JOIN "BrokerRequestCredit" c ON c."userId" = u.id
         WHERE u."recordStatus" = $1 AND EXISTS (
           SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
           WHERE ur."userId" = u.id AND r."recordStatus" = $1 AND r.name = $2
         )
         ORDER BY name`,
        [RecordStatus.Active, BROKER_ROLE, now],
      );
    return rows.map((row) => ({ ...row, companies: row.companies ?? 0, remaining: row.remaining ?? 0 }));
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

  /** نام همه‌ی شرکت‌ها، برای انتخاب‌ها و سفارش‌هایی که شرکتشان دیگر در فهرست انتخاب نیست. */
  private async companyNames(): Promise<Map<string, string>> {
    return new Map((await this.companies.listCompanies()).map((company) => [company.userId, companyView(company).name]));
  }

  //#endregion

  //#region ----------- Companies --------------------------------------------------

  /**
   * The broker picks the companies whose loads it sees, up to the admin's limit, free; a new pick replaces the old one.
   * Without a limit it sees every company's loads and picks nothing.
   */
  async selectCompanies(userId: string, companyUserIds: string[], now = new Date()) {
    if (!(await this.isBroker(userId))) throw new BadRequestException('انتخاب شرکت فقط برای حساب واسط است.');
    const { maxCompanies } = await this.getPolicy();
    if (maxCompanies === null) throw new BadRequestException('بار همه‌ی شرکت‌ها را می‌بینید و انتخاب لازم نیست.');
    const ids = [...new Set(companyUserIds)];
    if (!ids.length) throw new BadRequestException('دست‌کم یک شرکت انتخاب کنید.');
    if (ids.length > maxCompanies) throw new BadRequestException(`حداکثر ${maxCompanies.toLocaleString('fa-IR')} شرکت می‌توانید انتخاب کنید.`);
    const known = new Set((await this.companyList()).map((company) => company.userId));
    if (ids.some((id) => !known.has(id))) throw new BadRequestException('یکی از شرکت‌های انتخاب‌شده پیدا نشد.');
    await this.dataSource.transaction(async (manager) => {
      const periods = manager.getRepository(BrokerAccessPeriod);
      const current = await this.currentSelection(userId, now, manager);
      if (current) await periods.update({ id: current.id }, { companyUserIds: ids, expireAt: null });
      else await periods.save(periods.create({ userId, companyUserIds: ids, startAt: now, expireAt: null, orderId: null, grantedBy: null }));
    });
    return this.status(userId, now);
  }

  /** Companies added to the broker's own (an older purchase approved now): no end, like a pick. */
  private async addCompanies(manager: EntityManager, userId: string, companyUserIds: string[], now: Date, orderId: string): Promise<void> {
    const periods = manager.getRepository(BrokerAccessPeriod);
    const current = await this.currentSelection(userId, now, manager);
    if (current) {
      await periods.update({ id: current.id }, { companyUserIds: [...new Set([...current.companyUserIds, ...companyUserIds])], expireAt: null });
      return;
    }
    await periods.save(periods.create({ userId, companyUserIds: [...new Set(companyUserIds)], startAt: now, expireAt: null, orderId }));
  }

  //#endregion

  //#region ----------- Requests ---------------------------------------------------

  /**
   * One load request off the broker's packages, before the request is saved: false when nothing is counted (not a
   * broker, or packages off), true when one was taken (refundRequest gives it back if the request is not saved).
   * Throws ConflictException('noCredit') with none left.
   */
  async useRequest(userId: string): Promise<boolean> {
    if (!(await this.isBroker(userId)) || !(await this.getPolicy()).packagesEnabled) return false;
    // one statement, so two requests at once cannot both take the last one; Postgres gives [rows, count] for an UPDATE
    const [updated]: [Array<{ userId: string }>, number] = await this.dataSource.query(
      `UPDATE "BrokerRequestCredit" SET remaining = remaining - 1, "updatedAt" = now() WHERE "userId" = $1 AND remaining > 0 RETURNING "userId"`,
      [userId],
    );
    if (!updated.length) throw new ConflictException('noCredit');
    return true;
  }

  async refundRequest(userId: string): Promise<void> {
    await this.addCredit(this.dataSource.manager, userId, 1);
  }

  private async addCredit(manager: EntityManager, userId: string, requests: number): Promise<void> {
    await manager.query(
      `INSERT INTO "BrokerRequestCredit" ("userId", remaining) VALUES ($1, $2)
       ON CONFLICT ("userId") DO UPDATE SET remaining = "BrokerRequestCredit".remaining + EXCLUDED.remaining, "updatedAt" = now()`,
      [userId, requests],
    );
  }

  /** Requests given by the admin without a purchase (a gift, or to make up for something). */
  async grantRequests(userId: string, requests: number) {
    if (!(await this.isBroker(userId))) throw new NotFoundException('واسطی با این شناسه پیدا نشد.');
    await this.addCredit(this.dataSource.manager, userId, requests);
    return { remaining: await this.remaining(userId) };
  }

  /** A broker buys some packages with the receipt photo; the admin reviews it. */
  async submitPackageOrder(userId: string, packages: number, receiptPath: string) {
    if (!(await this.isBroker(userId))) throw new BadRequestException('بسته‌ی درخواست فقط برای حساب واسط است.');
    const policy = await this.getPolicy();
    if (!policy.packagesEnabled) throw new BadRequestException('درخواست بار الان رایگان است و خرید لازم ندارد.');
    if (!Number.isInteger(packages) || packages < 1 || packages > MAX_PACKAGES) throw new BadRequestException('تعداد بسته معتبر نیست.');
    const open = await this.orders.findOne({ where: { userId, kind: 'PACKAGE', status: SubscriptionOrderStatus.ReceiptSubmitted } });
    if (open) throw new ConflictException(`رسید قبلی شما برای ${this.titleOf(open)} در حال بررسی است.`);
    const order = await this.orders.save(
      this.orders.create({
        userId,
        kind: 'PACKAGE',
        periodId: null,
        companyUserIds: [],
        durationDays: null,
        requests: packages * policy.packageSize,
        amount: (BigInt(policy.packagePrice) * BigInt(packages)).toString(),
        currency: policy.currency,
        status: SubscriptionOrderStatus.ReceiptSubmitted,
        receiptPath,
      }),
    );
    await this.announce(REDIS_CHANNELS.brokerAccessReceipt, order);
    return this.orderView(order);
  }

  //#endregion

  //#region ----------- Orders ---------------------------------------------------

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

  /** تأیید فیش: درخواست‌های بسته به مانده‌ی واسط اضافه می‌شوند (خرید قدیمی شرکت: شرکت‌ها به انتخابش). */
  async approveOrder(orderId: string, adminUserId: string, now = new Date()) {
    const order = await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(BrokerAccessOrder, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new NotFoundException('سفارش پیدا نشد.');
      if (order.status !== SubscriptionOrderStatus.ReceiptSubmitted) throw new ConflictException('این سفارش قبلاً بررسی شده است.');
      if (order.kind === 'PACKAGE') await this.addCredit(manager, order.userId, order.requests ?? 0);
      else await this.addCompanies(manager, order.userId, order.companyUserIds, now, order.id);
      await manager.update(BrokerAccessOrder, { id: order.id }, { status: SubscriptionOrderStatus.Approved, reviewedBy: adminUserId, reviewedAt: now });
      return order;
    });
    const remaining = await this.remaining(order.userId);
    await this.announce(REDIS_CHANNELS.brokerAccessDecided, order, { approved: true, remaining });
    return { orderId: order.id, userId: order.userId, remaining };
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

  private titleOf(order: BrokerAccessOrder): string {
    return brokerOrderTitle({ kind: order.kind, requests: order.requests, companies: order.companyUserIds.length });
  }

  /** The admins (a new receipt) or the broker (a decision) hear of it through SubscriptionNotifier; failures are only logged. */
  private async announce(channel: string, order: BrokerAccessOrder, extra: Partial<BrokerAccessOrderEvent> = {}): Promise<void> {
    const event: BrokerAccessOrderEvent = {
      orderId: order.id,
      userId: order.userId,
      kind: order.kind,
      title: this.titleOf(order),
      companies: order.companyUserIds.length,
      requests: order.requests ?? null,
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
      title: this.titleOf(order),
      companies: order.companyUserIds.map((id) => ({ userId: id, name: names?.get(id) ?? '—' })),
      requests: order.requests ?? null,
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
