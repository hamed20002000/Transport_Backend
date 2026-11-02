import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThan, Not, Repository } from 'typeorm';

import { User } from 'src/domain/entities/auth/User';
import { CompanyFeatureGrant } from 'src/domain/entities/company/CompanyFeatureGrant';
import { CompanyFeatureOrder } from 'src/domain/entities/company/CompanyFeatureOrder';
import { CompanyFeaturePlan } from 'src/domain/entities/company/CompanyFeaturePlan';
import { CompanyTierPlan, TierOption } from 'src/domain/entities/company/CompanyTierPlan';
import {
  COMPANY_FEATURE_TITLES,
  COMPANY_TIER_TITLES,
  COMPANY_TIERS,
  CompanyFeature,
  CompanyTier,
  TIER_MONTH_DAYS,
  TIER_MONTHS,
  TierMonths,
  tierPeriodTitle,
} from 'src/domain/enums/companyFeature';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { RedisService } from '../redis/redis.service';
import { CompanyFeatureOrderEvent, REDIS_CHANNELS } from '../redis/redis.keys';

const DAY_MS = 86_400_000;
export const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];

/**
 * Buying the menus one by one (CompanyFeaturePlan): off for now, the tiers (برنزی، نقره‌ای، طلایی) sell them. The plans
 * stay in place; COMPANY_MENU_PURCHASE=on opens it again.
 */
export const menuPurchaseOn = () => process.env.COMPANY_MENU_PURCHASE?.trim().toLowerCase() === 'on';

/** «طرح طلایی ۳ ماهه» or «بخش «رانندگان»»: what an order bought, for receipts, notices and the payments list */
export const orderTitle = (order: Pick<CompanyFeatureOrder, 'tier' | 'feature' | 'durationDays'>) =>
  order.tier
    ? `طرح ${COMPANY_TIER_TITLES[order.tier]} ${tierPeriodTitle(order.durationDays)}`
    : `بخش «${order.feature ? COMPANY_FEATURE_TITLES[order.feature] : 'امکانات'}»`;

export function isCompanyRole(roles: string[] | undefined): boolean {
  return !!roles?.some((role) => COMPANY_ROLES.includes(role));
}

export interface CompanyFeatureState {
  feature: CompanyFeature;
  title: string;
  /** پلن فعالی دارد؛ وگرنه برای همه رایگان است */
  paid: boolean;
  /** الان بسته است و باید خریده شود */
  locked: boolean;
  /** پایان آخرین دوره‌ی خریده‌شده (اگر هنوز باز است) */
  expireAt: Date | null;
  /** this menu's own plans (only while menus are sold one by one) */
  plans: Array<Pick<CompanyFeaturePlan, 'id' | 'title' | 'durationDays' | 'price' | 'currency'>>;
  /** the active tiers that open it */
  tiers: CompanyTier[];
}

export interface CompanyTierState {
  tier: CompanyTier;
  title: string;
  features: Array<{ feature: CompanyFeature; title: string }>;
  /** the periods sold, shortest first */
  options: Array<{ months: TierMonths; durationDays: number; title: string; price: string }>;
  currency: string;
}

export interface UpdateTierInput {
  features: CompanyFeature[];
  /** a period without a price (or priced 0) is not sold */
  options: TierOption[];
  currency: string;
  active: boolean;
}

export interface CreateFeaturePlanInput {
  feature: CompanyFeature;
  title: string;
  durationDays: number;
  price: string;
  currency?: string;
  sortOrder?: number;
}

/**
 * شرکت حمل‌ونقل دو دسته است: شرکت مادر (User.isParentCompany) که همه‌ی منوها را دارد، و بقیه که هر منوی
 * پولی (CompanyFeature با پلن فعال) را برای مدتی می‌خرند. شرکتی که با لینک دعوت شرکت مادر آمده
 * (User.invitedByCompanyUserId) همه‌ی منوها را باید بخرد، حتی منویی که هنوز پلن ندارد (تا پلنش تعریف شود قفل
 * می‌ماند). یک جواب برای پنل وب، ربات‌ها و واتساپ.
 */
@Injectable()
export class CompanyFeatureService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(CompanyFeaturePlan) private readonly plans: Repository<CompanyFeaturePlan>,
    @InjectRepository(CompanyFeatureOrder) private readonly orders: Repository<CompanyFeatureOrder>,
    @InjectRepository(CompanyFeatureGrant) private readonly grants: Repository<CompanyFeatureGrant>,
    private readonly redis: RedisService,
    @InjectRepository(CompanyTierPlan) private readonly tiers: Repository<CompanyTierPlan>,
  ) {}

  //#region ----------- Access ---------------------------------------------------

  async isParent(userId: string): Promise<boolean> {
    return (await this.standing(userId)).isParent;
  }

  /** مادر، یا دعوت‌شده (همه‌ی منوها تا خرید قفل)، یا شرکت عادی (فقط منوهای پلن‌دار پولی‌اند). */
  async standing(userId: string): Promise<{ isParent: boolean; invited: boolean; verified: boolean }> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true, isParentCompany: true, invitedByCompanyUserId: true, verificationStatus: true } });
    return {
      isParent: !!user?.isParentCompany,
      invited: !user?.isParentCompany && !!user?.invitedByCompanyUserId,
      // a company that signed up on its own works only after a parent company checks it (AccountVerificationService)
      verified: !user || user.verificationStatus === 'APPROVED',
    };
  }

  async hasFeature(userId: string, feature: CompanyFeature, now = new Date()): Promise<boolean> {
    return !(await this.lockedFeatures(userId, now)).has(feature);
  }

  /** منوهایی که این شرکت الان ندارد: پولی‌ها منهای دوره‌های باز؛ برای شرکت مادر خالی. */
  async lockedFeatures(userId: string, now = new Date()): Promise<Set<CompanyFeature>> {
    const { isParent, invited, verified } = await this.standing(userId);
    if (isParent) return new Set();
    // not checked yet: nothing at all, bought or not
    if (!verified) return new Set(Object.values(CompanyFeature));
    const locked = invited ? new Set(Object.values(CompanyFeature)) : await this.paidFeatures();
    if (!locked.size) return locked;
    for (const feature of (await this.openGrants(userId, now)).keys()) locked.delete(feature);
    return locked;
  }

  /** وضعیت همه‌ی منوها و طرح‌ها برای صفحه‌ی خرید. */
  async status(userId: string, now = new Date()) {
    const [{ isParent, invited, verified }, plans, tiers, open, currentTier, latestOrders] = await Promise.all([
      this.standing(userId),
      menuPurchaseOn() ? this.activePlans() : Promise.resolve([] as CompanyFeaturePlan[]),
      this.activeTiers(),
      this.openGrants(userId, now),
      this.currentTier(userId, now),
      this.orders.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    const features: CompanyFeatureState[] = Object.values(CompanyFeature).map((feature) => {
      const own = plans.filter((plan) => plan.feature === feature);
      const inTiers = tiers.filter((tier) => tier.features.includes(feature)).map((tier) => tier.tier);
      const paid = own.length > 0 || inTiers.length > 0;
      const expireAt = open.get(feature) ?? null;
      return {
        feature,
        title: COMPANY_FEATURE_TITLES[feature],
        paid,
        locked: !isParent && (!verified || ((invited || paid) && !expireAt)),
        expireAt,
        plans: own.map(({ id, title, durationDays, price, currency }) => ({ id, title, durationDays, price, currency })),
        tiers: inTiers,
      };
    });
    return {
      isParent,
      invited,
      verified,
      menuPurchase: menuPurchaseOn(),
      tiers: tiers.map((tier) => this.tierView(tier)),
      currentTier,
      features,
      orders: latestOrders.map((order) => this.orderView(order)),
    };
  }

  /** Menus a company pays for: those in an active tier, and those with a plan of their own while menus are sold one by one. */
  private async paidFeatures(): Promise<Set<CompanyFeature>> {
    const paid = new Set((await this.activeTiers()).flatMap((tier) => tier.features));
    if (!menuPurchaseOn()) return paid;
    const rows: Array<{ feature: CompanyFeature }> = await this.plans
      .createQueryBuilder('plan')
      .select('DISTINCT plan.feature', 'feature')
      .where('plan.recordStatus = :active', { active: RecordStatus.Active })
      .getRawMany();
    for (const row of rows) paid.add(row.feature);
    return paid;
  }

  /** The tier whose time runs longest among those the company bought and still has, or null. */
  private async currentTier(userId: string, now: Date): Promise<{ tier: CompanyTier; title: string; expireAt: Date } | null> {
    const rows: Array<{ tier: CompanyTier; expireAt: Date }> = await this.dataSource.query(
      `SELECT o.tier, max(g."expireAt") AS "expireAt"
         FROM "CompanyFeatureGrant" g JOIN "CompanyFeatureOrder" o ON o.id = g."orderId"
        WHERE g."userId" = $1 AND g."expireAt" > $2 AND o.tier IS NOT NULL
        GROUP BY o.tier ORDER BY 2 DESC LIMIT 1`,
      [userId, now],
    );
    const row = rows[0];
    return row ? { tier: row.tier, title: COMPANY_TIER_TITLES[row.tier], expireAt: new Date(row.expireAt) } : null;
  }

  /** منو → پایان دوره‌ی باز (آخرین expireAt بین دوره‌هایی که الان شروع شده‌اند یا پشت سرشان‌اند). */
  private async openGrants(userId: string, now: Date): Promise<Map<CompanyFeature, Date>> {
    const rows = await this.grants.find({ where: { userId, expireAt: MoreThan(now) } });
    const open = new Map<CompanyFeature, Date>();
    for (const row of rows) {
      const current = open.get(row.feature);
      if (!current || row.expireAt > current) open.set(row.feature, row.expireAt);
    }
    // a grant waiting behind another one starts later, but the chain has no gap: what counts is that one has started
    for (const feature of [...open.keys()]) {
      if (!rows.some((row) => row.feature === feature && row.startAt <= now)) open.delete(feature);
    }
    return open;
  }

  //#endregion

  //#region ----------- Parent company -------------------------------------------

  async setParent(userId: string, isParent: boolean): Promise<{ userId: string; isParentCompany: boolean }> {
    const user = await this.users.findOne({ where: { id: userId }, relations: { userRoles: { role: true } } });
    const roles = user?.userRoles?.filter((item) => item.role?.recordStatus === RecordStatus.Active).map((item) => item.role.name);
    if (!user || !isCompanyRole(roles)) throw new NotFoundException('شرکت حمل‌ونقلی با این شناسه پیدا نشد.');
    await this.users.update({ id: userId }, { isParentCompany: isParent });
    return { userId, isParentCompany: isParent };
  }

  /** شرکت‌های حمل‌ونقل فعال برای صفحه‌ی ادمین، مادرها اول. */
  async listCompanies() {
    const rows: Array<{ userId: string; name: string | null; mobile: string | null; accountCode: string | null; isParentCompany: boolean; invitedByCompanyUserId: string | null }> = await this.dataSource.query(
      `SELECT DISTINCT u.id AS "userId",
         COALESCE(NULLIF(u."companyName", ''), NULLIF(concat_ws(' ', u."firstName", u."lastName"), ''), u.username) AS name,
         u.mobile, u."accountCode", u."isParentCompany", u."invitedByCompanyUserId"
       FROM "User" u
       JOIN "UserRole" ur ON ur."userId" = u.id
       JOIN "Role" r ON r.id = ur."roleId"
       WHERE u."recordStatus" = $1 AND r."recordStatus" = $1 AND r.name = ANY($2::text[])
       ORDER BY u."isParentCompany" DESC, name`,
      [RecordStatus.Active, COMPANY_ROLES],
    );
    return rows;
  }

  //#endregion

  //#region ----------- Plans ----------------------------------------------------

  activePlans(): Promise<CompanyFeaturePlan[]> {
    return this.plans.find({ where: { recordStatus: RecordStatus.Active }, order: { feature: 'ASC', sortOrder: 'ASC', createdAt: 'DESC' } });
  }

  createPlan(input: CreateFeaturePlanInput): Promise<CompanyFeaturePlan> {
    return this.plans.save(this.plans.create({ ...input, recordStatus: RecordStatus.Active }));
  }

  // only deactivates: orders keep their plan; a feature left without active plans becomes free again
  async deactivatePlan(id: string): Promise<{ id: string }> {
    const result = await this.plans.update({ id, recordStatus: RecordStatus.Active }, { recordStatus: RecordStatus.Inactive });
    if (!result.affected) throw new NotFoundException('پلن پیدا نشد.');
    return { id };
  }

  //#endregion

  //#region ----------- Tiers ----------------------------------------------------

  /** The three tiers in their order, active or not (the admin's page). */
  async listTiers(): Promise<Array<CompanyTierState & { active: boolean }>> {
    const rows = await this.tiers.find();
    return COMPANY_TIERS.map((tier) => rows.find((row) => row.tier === tier))
      .filter((row): row is CompanyTierPlan => !!row)
      .map((row) => ({ ...this.tierView(row), active: row.recordStatus === RecordStatus.Active }));
  }

  /** The tiers on sale, cheapest first. */
  private async activeTiers(): Promise<CompanyTierPlan[]> {
    const rows = await this.tiers.find({ where: { recordStatus: RecordStatus.Active } });
    return COMPANY_TIERS.map((tier) => rows.find((row) => row.tier === tier)).filter((row): row is CompanyTierPlan => !!row);
  }

  /** The admin sets a tier's menus and the price of each period; on sale only with a menu and a priced period. */
  async updateTier(tier: CompanyTier, input: UpdateTierInput) {
    const features = Object.values(CompanyFeature).filter((feature) => input.features.includes(feature));
    const options = TIER_MONTHS.map((months) => input.options.find((option) => option.months === months))
      .filter((option): option is TierOption => !!option && BigInt(option.price) > 0n)
      .map(({ months, price }) => ({ months, price }));
    if (input.active && (!features.length || !options.length)) {
      throw new BadRequestException('طرح فعال باید دست‌کم یک بخش و قیمت دست‌کم یک مدت را داشته باشد.');
    }
    const result = await this.tiers.update(
      { tier },
      { features, options, currency: input.currency, recordStatus: input.active ? RecordStatus.Active : RecordStatus.Inactive },
    );
    if (!result.affected) throw new NotFoundException('طرح پیدا نشد.');
    return (await this.listTiers()).find((item) => item.tier === tier)!;
  }

  /** A company buys a tier for one of its periods with the receipt photo; the admin reviews it like a menu's. */
  async submitTierOrder(userId: string, tier: CompanyTier, months: TierMonths, receiptPath: string) {
    if (await this.isParent(userId)) throw new BadRequestException('شرکت مادر همه‌ی بخش‌ها را بدون خرید دارد.');
    const plan = await this.tiers.findOne({ where: { tier, recordStatus: RecordStatus.Active } });
    if (!plan?.features.length) throw new NotFoundException('این طرح فعال نیست.');
    const option = plan.options.find((item) => item.months === months);
    if (!option) throw new NotFoundException('این طرح برای این مدت فروخته نمی‌شود.');
    const open = await this.orders.findOne({ where: { userId, tier: Not(IsNull()), status: SubscriptionOrderStatus.ReceiptSubmitted } });
    if (open) throw new ConflictException(`رسید قبلی شما برای ${orderTitle(open)} در حال بررسی است.`);
    const order = await this.orders.save(
      this.orders.create({
        userId,
        planId: null,
        feature: null,
        tier,
        features: plan.features,
        durationDays: TIER_MONTH_DAYS[months],
        amount: option.price,
        currency: plan.currency,
        status: SubscriptionOrderStatus.ReceiptSubmitted,
        receiptPath,
      }),
    );
    await this.announce(REDIS_CHANNELS.companyFeatureReceipt, order);
    return this.orderView(order);
  }

  private tierView(plan: CompanyTierPlan): CompanyTierState {
    return {
      tier: plan.tier,
      title: COMPANY_TIER_TITLES[plan.tier],
      features: plan.features.map((feature) => ({ feature, title: COMPANY_FEATURE_TITLES[feature] })),
      options: TIER_MONTHS.map((months) => plan.options.find((option) => option.months === months))
        .filter((option): option is TierOption => !!option)
        .map(({ months, price }) => ({ months, durationDays: TIER_MONTH_DAYS[months], title: tierPeriodTitle(TIER_MONTH_DAYS[months]), price })),
      currency: plan.currency,
    };
  }

  //#endregion

  //#region ----------- Orders ---------------------------------------------------

  /** شرکت غیرمادر یک پلن را با عکس فیش می‌خرد؛ ادمین بررسی می‌کند. */
  async submitOrder(userId: string, planId: string, receiptPath: string) {
    if (!menuPurchaseOn()) throw new BadRequestException('خرید بخش‌به‌بخش فعلاً بسته است؛ یکی از طرح‌های برنزی، نقره‌ای یا طلایی را بخرید.');
    if (await this.isParent(userId)) throw new BadRequestException('شرکت مادر همه‌ی بخش‌ها را بدون خرید دارد.');
    const plan = await this.plans.findOne({ where: { id: planId, recordStatus: RecordStatus.Active } });
    if (!plan) throw new NotFoundException('این پلن فعال نیست.');
    const open = await this.orders.findOne({ where: { userId, feature: plan.feature, status: SubscriptionOrderStatus.ReceiptSubmitted } });
    if (open) throw new ConflictException('رسید قبلی شما برای همین بخش در حال بررسی است.');
    const order = await this.orders.save(
      this.orders.create({
        userId,
        planId: plan.id,
        feature: plan.feature,
        durationDays: plan.durationDays,
        amount: plan.price,
        currency: plan.currency,
        status: SubscriptionOrderStatus.ReceiptSubmitted,
        receiptPath,
      }),
    );
    await this.announce(REDIS_CHANNELS.companyFeatureReceipt, order);
    return this.orderView(order);
  }

  listOrders(statuses: SubscriptionOrderStatus[]) {
    return this.orders.find({
      where: { status: In(statuses) },
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: 100,
    }).then((orders) =>
      orders.map((order) => ({
        ...this.orderView(order),
        userId: order.userId,
        company: order.user?.companyName || [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') || order.user?.username,
        mobile: order.user?.mobile ?? null,
        accountCode: order.user?.accountCode ?? null,
      })),
    );
  }

  findOrder(id: string): Promise<CompanyFeatureOrder | null> {
    return this.orders.findOne({ where: { id } });
  }

  /**
   * تأیید فیش: هر منوی سفارش (یک منو، یا همه‌ی منوهای طرح) دوره‌ی تازه‌ای می‌گیرد که بعد از پایان دوره‌ی باز همان
   * منو (یا از الان) شروع می‌شود.
   */
  async approveOrder(orderId: string, adminUserId: string, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(CompanyFeatureOrder, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new NotFoundException('سفارش پیدا نشد.');
      if (order.status !== SubscriptionOrderStatus.ReceiptSubmitted) throw new ConflictException('این سفارش قبلاً بررسی شده است.');
      const features = order.tier ? order.features ?? [] : order.feature ? [order.feature] : [];
      const grants: CompanyFeatureGrant[] = [];
      for (const feature of features) {
        grants.push(await this.addGrant(manager.getRepository(CompanyFeatureGrant), order.userId, feature, order.durationDays, now, {
          orderId: order.id,
          grantedBy: adminUserId,
        }));
      }
      if (!grants.length) throw new ConflictException('این سفارش هیچ بخشی ندارد.');
      // a tier's menus may end on different days (some had time left): the latest end is the order's
      const grant = grants.reduce((latest, item) => (item.expireAt > latest.expireAt ? item : latest));
      await manager.update(CompanyFeatureOrder, { id: order.id }, {
        status: SubscriptionOrderStatus.Approved,
        reviewedBy: adminUserId,
        reviewedAt: now,
      });
      return { order, result: { orderId: order.id, userId: order.userId, feature: order.feature, tier: order.tier, startAt: grant.startAt, expireAt: grant.expireAt } };
    }).then(async ({ order, result }) => {
      await this.announce(REDIS_CHANNELS.companyFeatureDecided, order, { approved: true, expireAt: result.expireAt.toISOString() });
      return result;
    });
  }

  async rejectOrder(orderId: string, adminUserId: string, reason: string, now = new Date()) {
    const result = await this.orders.update(
      { id: orderId, status: SubscriptionOrderStatus.ReceiptSubmitted },
      { status: SubscriptionOrderStatus.Rejected, rejectionReason: reason, reviewedBy: adminUserId, reviewedAt: now },
    );
    if (!result.affected) throw new ConflictException('سفارشی در انتظار بررسی با این شناسه نیست.');
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (order) await this.announce(REDIS_CHANNELS.companyFeatureDecided, order, { approved: false, reason });
    return { orderId };
  }

  /** The admins (a new receipt) or the company (a decision) hear of it through SubscriptionNotifier; failures are only logged. */
  private async announce(channel: string, order: CompanyFeatureOrder, extra: Partial<CompanyFeatureOrderEvent> = {}): Promise<void> {
    const event: CompanyFeatureOrderEvent = {
      orderId: order.id,
      userId: order.userId,
      feature: order.feature,
      tier: order.tier,
      title: orderTitle(order),
      amount: order.amount,
      currency: order.currency,
      ...extra,
    };
    await this.redis.publish(channel, JSON.stringify(event)).catch(() => undefined);
  }

  /** باز کردن منو بی‌خرید (هدیه یا جبران) توسط ادمین. */
  grant(userId: string, feature: CompanyFeature, days: number, adminUserId: string, now = new Date()) {
    return this.addGrant(this.grants, userId, feature, days, now, { orderId: null, grantedBy: adminUserId });
  }

  private async addGrant(
    grants: Repository<CompanyFeatureGrant>,
    userId: string,
    feature: CompanyFeature,
    days: number,
    now: Date,
    source: Pick<CompanyFeatureGrant, 'orderId' | 'grantedBy'>,
  ): Promise<CompanyFeatureGrant> {
    const latest = await grants.findOne({ where: { userId, feature, expireAt: MoreThan(now) }, order: { expireAt: 'DESC' } });
    const startAt = latest ? latest.expireAt : now;
    return grants.save(grants.create({ userId, feature, startAt, expireAt: new Date(startAt.getTime() + days * DAY_MS), ...source }));
  }

  private orderView(order: CompanyFeatureOrder) {
    return {
      id: order.id,
      feature: order.feature,
      tier: order.tier,
      features: order.features,
      title: orderTitle(order),
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
