import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../../domain/entities/setting/AppSetting';

const SETTING_KEY = 'subscriptionPolicy';
// چند نمونه‌ی برنامه: تغییر ادمین حداکثر بعد از این مدت به بقیه هم می‌رسد.
const CACHE_TTL_MS = 15_000;

export interface SubscriptionPolicy {
  /** خاموش = هیچ‌جا اشتراک لازم نیست (منوی ربات، ثبت گروه/کانال، اعلان بار). */
  enforced: boolean;
  /** تا این زمان استفاده رایگان است و بعد از آن (اگر enforced باشد) خودکار اجباری می‌شود. */
  freeUntil: string | null;
}

export interface SubscriptionPolicyStatus extends SubscriptionPolicy {
  /** همین الان اشتراک لازم است یا نه. */
  required: boolean;
}

/** پیش‌فرض تا وقتی ادمین چیزی تنظیم نکرده: اشتراک لازم نیست. */
const DEFAULT_POLICY: SubscriptionPolicy = { enforced: false, freeUntil: null };

/**
 * اجباری بودن اشتراک، قابل تغییر در زمان اجرا از پنل ادمین
 * (PUT /api/admin/subscription-policy) بدون ری‌استارت.
 */
@Injectable()
export class SubscriptionPolicyService {
  private readonly logger = new Logger(SubscriptionPolicyService.name);
  private cached?: { policy: SubscriptionPolicy; expiresAt: number };

  constructor(@InjectRepository(AppSetting) private readonly settings: Repository<AppSetting>) {}

  async isRequired(now = new Date()): Promise<boolean> {
    return (await this.getStatus(now)).required;
  }

  async getStatus(now = new Date()): Promise<SubscriptionPolicyStatus> {
    const policy = await this.getPolicy();
    const free = policy.freeUntil !== null && now < new Date(policy.freeUntil);
    return { ...policy, required: policy.enforced && !free };
  }

  async update(policy: SubscriptionPolicy, adminUserId?: string): Promise<SubscriptionPolicyStatus> {
    await this.settings.save(this.settings.create({
      key: SETTING_KEY,
      value: { ...policy },
      updatedByUserId: adminUserId ?? null,
    }));
    this.cached = { policy, expiresAt: Date.now() + CACHE_TTL_MS };
    this.logger.log(`Subscription policy changed: enforced=${policy.enforced}, freeUntil=${policy.freeUntil ?? '-'}`);
    return this.getStatus();
  }

  private async getPolicy(): Promise<SubscriptionPolicy> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.policy;
    let policy = DEFAULT_POLICY;
    try {
      const row = await this.settings.findOne({ where: { key: SETTING_KEY } });
      if (row) {
        policy = {
          enforced: row.value.enforced === true,
          freeUntil: typeof row.value.freeUntil === 'string' ? row.value.freeUntil : null,
        };
      }
    } catch (error) {
      // مثلاً migration جدول AppSetting هنوز اجرا نشده: ربات نباید به خاطرش از کار بیفتد.
      this.logger.warn(`Could not load subscription policy, subscription is not required: ${(error as Error).message}`);
    }
    this.cached = { policy, expiresAt: Date.now() + CACHE_TTL_MS };
    return policy;
  }
}
