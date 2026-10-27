import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';

import { User } from 'src/domain/entities/auth/User';
import { CompanyFeatureGrant } from 'src/domain/entities/company/CompanyFeatureGrant';
import { CompanyFeatureOrder } from 'src/domain/entities/company/CompanyFeatureOrder';
import { CompanyFeaturePlan } from 'src/domain/entities/company/CompanyFeaturePlan';
import { COMPANY_FEATURE_TITLES, CompanyFeature } from 'src/domain/enums/companyFeature';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { SubscriptionOrderStatus } from 'src/domain/enums/subscription';
import { RedisService } from '../redis/redis.service';
import { CompanyFeatureOrderEvent, REDIS_CHANNELS } from '../redis/redis.keys';

const DAY_MS = 86_400_000;
export const COMPANY_ROLES = ['COMPANY', 'COMPANY_ADMIN'];

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
  plans: Array<Pick<CompanyFeaturePlan, 'id' | 'title' | 'durationDays' | 'price' | 'currency'>>;
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

  /** وضعیت همه‌ی منوها برای صفحه‌ی خرید. */
  async status(userId: string, now = new Date()) {
    const [{ isParent, invited, verified }, plans, open, latestOrders] = await Promise.all([
      this.standing(userId),
      this.activePlans(),
      this.openGrants(userId, now),
      this.orders.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    const features: CompanyFeatureState[] = Object.values(CompanyFeature).map((feature) => {
      const own = plans.filter((plan) => plan.feature === feature);
      const expireAt = open.get(feature) ?? null;
      return {
        feature,
        title: COMPANY_FEATURE_TITLES[feature],
        paid: own.length > 0,
        locked: !isParent && (!verified || ((invited || own.length > 0) && !expireAt)),
        expireAt,
        plans: own.map(({ id, title, durationDays, price, currency }) => ({ id, title, durationDays, price, currency })),
      };
    });
    return { isParent, invited, verified, features, orders: latestOrders.map((order) => this.orderView(order)) };
  }

  private async paidFeatures(): Promise<Set<CompanyFeature>> {
    const rows: Array<{ feature: CompanyFeature }> = await this.plans
      .createQueryBuilder('plan')
      .select('DISTINCT plan.feature', 'feature')
      .where('plan.recordStatus = :active', { active: RecordStatus.Active })
      .getRawMany();
    return new Set(rows.map((row) => row.feature));
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
    const rows: Array<{ userId: string; name: string | null; mobile: string | null; isParentCompany: boolean }> = await this.dataSource.query(
      `SELECT DISTINCT u.id AS "userId",
         COALESCE(NULLIF(u."companyName", ''), NULLIF(concat_ws(' ', u."firstName", u."lastName"), ''), u.username) AS name,
         u.mobile, u."isParentCompany"
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

  //#region ----------- Orders ---------------------------------------------------

  /** شرکت غیرمادر یک پلن را با عکس فیش می‌خرد؛ ادمین بررسی می‌کند. */
  async submitOrder(userId: string, planId: string, receiptPath: string) {
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
      })),
    );
  }

  findOrder(id: string): Promise<CompanyFeatureOrder | null> {
    return this.orders.findOne({ where: { id } });
  }

  /** تأیید فیش: دوره‌ی تازه بعد از پایان دوره‌ی باز همان منو (یا از الان) شروع می‌شود. */
  async approveOrder(orderId: string, adminUserId: string, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(CompanyFeatureOrder, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new NotFoundException('سفارش پیدا نشد.');
      if (order.status !== SubscriptionOrderStatus.ReceiptSubmitted) throw new ConflictException('این سفارش قبلاً بررسی شده است.');
      const grant = await this.addGrant(manager.getRepository(CompanyFeatureGrant), order.userId, order.feature, order.durationDays, now, {
        orderId: order.id,
        grantedBy: adminUserId,
      });
      await manager.update(CompanyFeatureOrder, { id: order.id }, {
        status: SubscriptionOrderStatus.Approved,
        reviewedBy: adminUserId,
        reviewedAt: now,
      });
      return { order, result: { orderId: order.id, userId: order.userId, feature: order.feature, startAt: grant.startAt, expireAt: grant.expireAt } };
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
      title: COMPANY_FEATURE_TITLES[order.feature],
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
      title: COMPANY_FEATURE_TITLES[order.feature],
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
