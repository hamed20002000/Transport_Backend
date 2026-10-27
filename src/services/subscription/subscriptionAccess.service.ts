import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/auth/User';
import { RecordStatus } from 'src/domain/enums/RecordStatus';
import { SUBSCRIPTION_REPOSITORY } from 'src/domain/repositories/repository.tokens';
import { ISubscriptionRepository } from 'src/domain/repositories/subscription/ISubscriptionRepository';
import { SubscriptionPolicyService } from './subscriptionPolicy.service';
import { SubscriptionRewardService } from './subscriptionReward.service';

const DAY_MS = 86_400_000;
const DRIVER_ROLE = 'DRIVER';

export type SubscriptionAccessReason =
  /** اشتراک فعال دارد */
  | 'subscribed'
  /** روزهای رایگان هدیه (مثلاً پاداش خرید زیاد) */
  | 'bonus'
  /** راننده در دوره‌ی رایگانش */
  | 'trial'
  /** برای این کاربر اشتراک لازم نیست (سیاست خاموش یا دوره‌ی رایگان عمومی) */
  | 'free'
  /** اشتراک لازم است و ندارد: کاری جز خرید ندارد */
  | 'required';

export interface SubscriptionAccess {
  allowed: boolean;
  reason: SubscriptionAccessReason;
  isDriver: boolean;
  /** پایان دوره‌ی رایگان راننده (برای نمایش «n روز مانده»)؛ برای بقیه null */
  trialEndsAt: Date | null;
  /** پایان اشتراک فعال */
  expireAt: Date | null;
  /** پایان روزهای هدیه‌ای که الان در آن است */
  bonusUntil: Date | null;
}

/**
 * یک جواب برای «این کاربر الان می‌تواند کار کند؟» در همه‌جا: پنل وب، ربات‌ها، واتساپ، agent.
 * راننده: اشتراک، یا دوره‌ی رایگانش (SubscriptionPolicy.driverTrial*)؛ بقیه‌ی نقش‌ها: همان سیاست عمومی.
 */
@Injectable()
export class SubscriptionAccessService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptions: ISubscriptionRepository,
    private readonly policy: SubscriptionPolicyService,
    private readonly rewards: SubscriptionRewardService,
  ) {}

  async check(userId: string, now = new Date()): Promise<SubscriptionAccess> {
    const [user, subscription, bonusUntil] = await Promise.all([
      this.users.findOne({ where: { id: userId }, relations: { userRoles: { role: true } } }),
      this.subscriptions.findActiveByUserId(userId),
      this.rewards.activeUntil(userId, now),
    ]);
    const isDriver = !!user?.userRoles?.some(
      (userRole) => userRole.role?.name === DRIVER_ROLE && userRole.role.recordStatus === RecordStatus.Active,
    );
    const trialEndsAt = isDriver && user ? await this.driverTrialEndsAt(user.createdAt) : null;
    const expireAt = subscription?.expireAt ?? null;
    const result = (allowed: boolean, reason: SubscriptionAccessReason): SubscriptionAccess =>
      ({ allowed, reason, isDriver, trialEndsAt, expireAt, bonusUntil });

    if (subscription) return result(true, 'subscribed');
    // شرکت مادر به همه چیز دسترسی دارد (CompanyFeatureService)، اشتراک هم لازم ندارد
    if (user?.isParentCompany) return result(true, 'free');
    // کارخانه فقط بار برای شرکت‌هایی که دعوتش کرده‌اند می‌فرستد؛ اشتراک ندارد
    if (user?.userRoles?.some((userRole) => userRole.role?.name === 'FACTORY' && userRole.role.recordStatus === RecordStatus.Active)) return result(true, 'free');
    if (bonusUntil) return result(true, 'bonus');
    if (isDriver) {
      const rule = await this.policy.getDriverRule();
      if (!rule.driversEnforced) return result(true, 'free');
      return trialEndsAt && now < trialEndsAt ? result(true, 'trial') : result(false, 'required');
    }
    return (await this.policy.isRequired(now)) ? result(false, 'required') : result(true, 'free');
  }

  /** پایان دوره‌ی رایگان راننده‌ای که این زمان ثبت‌نام کرده (رانندگان قبل از این قاعده: از شروع قاعده). */
  async driverTrialEndsAt(registeredAt: Date): Promise<Date> {
    const rule = await this.policy.getDriverRule();
    const start = Math.max(registeredAt.getTime(), Date.parse(rule.driverTrialStartedAt));
    return new Date(start + rule.driverTrialDays * DAY_MS);
  }
}
