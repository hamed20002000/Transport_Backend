import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../../domain/entities/setting/AppSetting';
import { RedisService } from '../redis/redis.service';
import { REDIS_CHANNELS } from '../redis/redis.keys';

const SETTING_KEY = 'subscriptionPolicy';
/**
 * کش محلی کوتاه تا روی هر پیام ربات به Redis درخواست نرود. تغییر ادمین با pub/sub
 * فوری به همه‌ی نمونه‌ها می‌رسد؛ این زمان فقط سقف تأخیر وقتی پیام pub/sub گم شود.
 */
const LOCAL_TTL_MS = 5_000;
/** دیتابیس منبع اصلی است؛ Redis فقط کش مشترک بین نمونه‌هاست. */
const REDIS_TTL_SECONDS = 86_400;

export interface SubscriptionPolicy {
  /** خاموش = برای شرکت‌ها و بقیه‌ی نقش‌ها اشتراک لازم نیست (منوی ربات، ثبت گروه/کانال، پیشنهاد بار). */
  enforced: boolean;
  /** تا این زمان استفاده رایگان است و بعد از آن (اگر enforced باشد) خودکار اجباری می‌شود. */
  freeUntil: string | null;
  /**
   * راننده‌ها قاعده‌ی خودشان را دارند: هر راننده driverTrialDays روز رایگان، از ثبت‌نامش یا از
   * driverTrialStartedAt (هر کدام دیرتر، تا رانندگانی که قبل از این قاعده بودند هم دوره‌ی کامل بگیرند)،
   * و بعد از آن بدون اشتراک هیچ کاری جز خرید ندارد. driversEnforced خاموش = راننده هم آزاد.
   */
  driversEnforced: boolean;
  driverTrialDays: number;
  driverTrialStartedAt: string;
}

export interface SubscriptionPolicyStatus extends SubscriptionPolicy {
  /** همین الان اشتراک لازم است یا نه. */
  required: boolean;
}

/** روزی که قاعده‌ی دوره‌ی رایگان راننده اعمال شد؛ رانندگان قبل از آن از همین روز یک ماه رایگان دارند. */
const DRIVER_TRIAL_ROLLOUT = '2026-10-25T00:00:00.000Z';
const DEFAULT_DRIVER_TRIAL_DAYS = 30;

/**
 * پیش‌فرض تا وقتی ادمین چیزی تنظیم نکرده: برای شرکت‌ها اشتراک لازم نیست؛ راننده یک ماه رایگان و بعد اجباری.
 */
const DEFAULT_POLICY: SubscriptionPolicy = {
  enforced: false,
  freeUntil: null,
  driversEnforced: true,
  driverTrialDays: DEFAULT_DRIVER_TRIAL_DAYS,
  driverTrialStartedAt: DRIVER_TRIAL_ROLLOUT,
};

/**
 * اجباری بودن اشتراک، قابل تغییر در زمان اجرا از پنل ادمین
 * (PUT /api/admin/subscription-policy) بدون ری‌استارت.
 */
@Injectable()
export class SubscriptionPolicyService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionPolicyService.name);
  private cached?: { policy: SubscriptionPolicy; expiresAt: number };

  constructor(
    @InjectRepository(AppSetting) private readonly settings: Repository<AppSetting>,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      // تغییر ادمین در هر نمونه‌ای: کش محلی این نمونه پاک می‌شود و بار بعد از Redis خوانده می‌شود.
      await this.redis.subscribe(REDIS_CHANNELS.subscriptionPolicyChanged, () => {
        this.cached = undefined;
      });
    } catch (error) {
      this.logger.warn(`Could not subscribe to subscription policy changes: ${(error as Error).message}`);
    }
  }

  /**
   * تعیین اینکه آیا  محدودیت سابسمکریپشن نیاز است یا نه
   * جدول appsetting رو بررسی میکنه اگه بود محدودیت یابسکریپشن لازم هست
   * که با توجه فیلد های سابسکریپشن باید اعمال بشه وگرنه حالت پیش فرض هست که  محدودیت لازم نیست
   * با استفاده از enforced محدودیت فعال بودن یا نبودنش معلوم میشود و با freeUntil مدت زمان غیر فعال بودن مشخص میشه
   * @param now 
   * @returns 
   */
  async isRequired(now = new Date()): Promise<boolean> {
    return (await this.getStatus(now)).required;
  }

  /**
   * وضعیت اعمال محدودیت سابسکریپشن پلن رو برمیگردونه
   * برای این کار از متد getplocy استفاده میکنه که به طور پیش فرض محدودیت اعمنال نمیشه
   * @param now
   * @returns 
   */
  //#region ---------------------------- به دست اوردن وضعیت سابسکریپشن پلن ---------------
  /** قاعده‌ی راننده (SubscriptionAccessService و فهرست رانندگانی که اعلان بار می‌گیرند). */
  async getDriverRule(): Promise<Pick<SubscriptionPolicy, 'driversEnforced' | 'driverTrialDays' | 'driverTrialStartedAt'>> {
    const { driversEnforced, driverTrialDays, driverTrialStartedAt } = await this.getPolicy();
    return { driversEnforced, driverTrialDays, driverTrialStartedAt };
  }

  async getStatus(now = new Date()): Promise<SubscriptionPolicyStatus> {
    const policy = await this.getPolicy();
    const free = policy.freeUntil !== null && now < new Date(policy.freeUntil);
    return { ...policy, required: policy.enforced && !free };
  }
  //#endregion ---------------------------------------------------------------------------

  /**
   * محدودیت سابسکریپشن پلن رو بروز میکنه
   * ایا اعمال بشه اگر اعمال بشه تا کی اعمال بشه
   * در ضمن در کش خود این کلاس ذخیره میکنه
   * @param policy 
   * @param adminUserId 
   * @returns 
   */

  //#region ---------------------------- بروزرسانی  محدودیت سابسکریپشن پلن -------------------
  async update(policy: SubscriptionPolicy, adminUserId?: string): Promise<SubscriptionPolicyStatus> {
    await this.settings.save(this.settings.create({
      key: SETTING_KEY,
      value: { ...policy },
      updatedByUserId: adminUserId ?? null,
    }));
    this.cached = { policy, expiresAt: Date.now() + LOCAL_TTL_MS };
    try {
      await this.redis.setJson(RedisService.key('subscriptionPolicy'), policy, REDIS_TTL_SECONDS);
      await this.redis.publish(REDIS_CHANNELS.subscriptionPolicyChanged, '1');
    } catch (error) {
      // دیتابیس ذخیره شده؛ بقیه‌ی نمونه‌ها بعد از انقضای کش Redis مقدار تازه را می‌خوانند.
      await this.redis.delete(RedisService.key('subscriptionPolicy')).catch(() => undefined);
      this.logger.warn(`Could not share subscription policy through Redis: ${(error as Error).message}`);
    }
    this.logger.log(
      `Subscription policy changed: enforced=${policy.enforced}, freeUntil=${policy.freeUntil ?? '-'}, ` +
        `drivers=${policy.driversEnforced} (${policy.driverTrialDays} free days from ${policy.driverTrialStartedAt})`,
    );
    return this.getStatus();
  }
  //#endregion --------------------------------------------------------------------------------

  /**
   * برای به دست آوردن تنظیمات مربوط به سابسکریپشن پلن که آیا فعال هست یا نه
   * ترتیب: کش محلی ← Redis (مشترک بین نمونه‌ها) ← جدول AppSetting با key=subscriptionPolicy
   * @returns
   */

  //#region --------------------------  به دست اوردن سابسکریپشن پلن -------------------------
  private async getPolicy(): Promise<SubscriptionPolicy> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.policy;
    const policy = (await this.fromRedis()) ?? (await this.fromDatabase());
    this.cached = { policy, expiresAt: Date.now() + LOCAL_TTL_MS };
    return policy;
  }
  //#endregion --------------------------------------------------------------------------------

  /**
   * به دست آوردن سابسکریوشن پلن از ردیس
   * @returns 
   */

  //#region ---------------------------- به دست اوردن سابسمریپشن از ردیس ------------------------
  private async fromRedis(): Promise<SubscriptionPolicy | null> {
    try {
      const value = await this.redis.getJson<Record<string, unknown>>(RedisService.key('subscriptionPolicy'));
      return value ? normalize(value) : null;
    } catch {
      // Redis در دسترس نیست: از دیتابیس خوانده می‌شود.
      return null;
    }
  }
  //#endregion ------------------------------------------------------------------------------------

  /**
   * اگه سابسکریپشن در ردیسی نبود به دیتابیس مراجعه میکنیم
   * @returns 
   */

  //#region ------------------------------ به دست آوردن سابسکریپشن از دیتابیس ---------------------
  private async fromDatabase(): Promise<SubscriptionPolicy> {
    let policy = DEFAULT_POLICY;
    try {
      const row = await this.settings.findOne({ where: { key: SETTING_KEY } });
      if (row) policy = normalize(row.value);
    } catch (error) {
      // مثلاً migration جدول AppSetting هنوز اجرا نشده: ربات نباید به خاطرش از کار بیفتد.
      this.logger.warn(`Could not load subscription policy, subscription is not required: ${(error as Error).message}`);
      return policy;
    }
    try {
      await this.redis.setJson(RedisService.key('subscriptionPolicy'), policy, REDIS_TTL_SECONDS);
    } catch {
      // کش Redis اختیاری است.
    }
    return policy;
  }
  //#endregion ------------------------------------------------------------------------------------
}

/** مقدار jsonb یا Redis از بیرون می‌آید؛ فقط شکل معتبر پذیرفته می‌شود. */
function normalize(value: Record<string, unknown>): SubscriptionPolicy {
  const days = Number(value.driverTrialDays);
  const startedAt = typeof value.driverTrialStartedAt === 'string' && !Number.isNaN(Date.parse(value.driverTrialStartedAt))
    ? value.driverTrialStartedAt
    : DRIVER_TRIAL_ROLLOUT;
  return {
    enforced: value.enforced === true,
    freeUntil: typeof value.freeUntil === 'string' ? value.freeUntil : null,
    // ردیف‌های قدیمی این فیلدها را ندارند: همان پیش‌فرض (راننده اجباری بعد از یک ماه)
    driversEnforced: value.driversEnforced !== false,
    driverTrialDays: Number.isSafeInteger(days) && days >= 0 ? days : DEFAULT_DRIVER_TRIAL_DAYS,
    driverTrialStartedAt: startedAt,
  };
}
