import { Body, Controller, ForbiddenException, Get, Logger, Put, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsISO8601, IsInt, IsOptional, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionPolicyService } from 'src/services/subscription/subscriptionPolicy.service';
import { SubscriptionRewardService } from 'src/services/subscription/subscriptionReward.service';

type AdminRequest = { user?: { userId?: string; roles?: string[]; isActive?: boolean } };

export function requireAdmin(request: AdminRequest): string | undefined {
  if (request.user?.isActive !== true || !request.user.roles?.includes('ADMIN')) {
    throw new ForbiddenException('Administrator access required.');
  }
  return request.user.userId;
}

export class DriverRewardDto {
  /** جمع خرید تأییدشده‌ی راننده (تومان) که هدیه را می‌دهد */
  @IsInt() @Min(1) @Max(1_000_000_000_000)
  minTomans!: number;

  @IsInt() @Min(1) @Max(365)
  freeDays!: number;
}

export class UpdateSubscriptionPolicyDto {
  /** false = اشتراک هیچ‌جا لازم نیست. */
  @IsBoolean()
  enforced!: boolean;

  /** تا این تاریخ رایگان؛ بعد از آن اگر enforced باشد خودکار اجباری می‌شود. null = بدون دوره‌ی رایگان. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  freeUntil?: string | null;

  /** راننده بعد از دوره‌ی رایگانش بدون اشتراک کاری جز خرید ندارد؛ false = راننده هم آزاد. نیامده = بدون تغییر. */
  @IsOptional()
  @IsBoolean()
  driversEnforced?: boolean;

  /** روزهای رایگان هر راننده (از ثبت‌نام، یا از شروع این قاعده برای رانندگان قدیمی). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  driverTrialDays?: number;

  /** پله‌های هدیه‌ی رانندگان پرخرید؛ نیامده = بدون تغییر، [] = بدون هدیه. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DriverRewardDto)
  driverRewards?: DriverRewardDto[];
}

/**
 * روشن/خاموش کردن اجباری بودن اشتراک بدون ری‌استارت.
 *   خاموش:                  { "enforced": false }
 *   اجباری از همین الان:    { "enforced": true, "freeUntil": null }
 *   ۳ ماه رایگان، بعد اجباری: { "enforced": true, "freeUntil": "2027-01-06T00:00:00Z" }
 */
@Controller('api/admin/subscription-policy')
@UseGuards(JwtAuthGuard)
export class SubscriptionPolicyController {
  private readonly logger = new Logger(SubscriptionPolicyController.name);

  constructor(
    private readonly policy: SubscriptionPolicyService,
    private readonly rewards: SubscriptionRewardService,
  ) {}

  @Get()
  get(@Req() request: AdminRequest) {
    requireAdmin(request);
    return this.policy.getStatus();
  }

  @Put()
  async update(@Req() request: AdminRequest, @Body() dto: UpdateSubscriptionPolicyDto) {
    const adminUserId = requireAdmin(request);
    const freeUntil = dto.freeUntil ? new Date(dto.freeUntil).toISOString() : null;
    const current = await this.policy.getStatus();
    const saved = await this.policy.update({
      enforced: dto.enforced,
      freeUntil,
      driversEnforced: dto.driversEnforced ?? current.driversEnforced,
      driverTrialDays: dto.driverTrialDays ?? current.driverTrialDays,
      driverTrialStartedAt: current.driverTrialStartedAt,
      driverRewards: dto.driverRewards ?? current.driverRewards,
    }, adminUserId);
    // a new or lower tier: drivers who already paid that much get it now, in the background
    if (dto.driverRewards) {
      void this.rewards.grantEarnedForAll()
        .then((count) => count && this.logger.log(`Gave ${count} purchase reward(s) after the tiers changed`))
        .catch((error: Error) => this.logger.warn(`Could not give purchase rewards: ${error.message}`));
    }
    return saved;
  }
}
