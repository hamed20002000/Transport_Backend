import { Body, Controller, ForbiddenException, Get, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsISO8601, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { SubscriptionPolicyService } from 'src/services/subscription/subscriptionPolicy.service';

type AdminRequest = { user?: { userId?: string; roles?: string[]; isActive?: boolean } };

export function requireAdmin(request: AdminRequest): string | undefined {
  if (request.user?.isActive !== true || !request.user.roles?.includes('ADMIN')) {
    throw new ForbiddenException('Administrator access required.');
  }
  return request.user.userId;
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
  constructor(private readonly policy: SubscriptionPolicyService) {}

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
    return this.policy.update({
      enforced: dto.enforced,
      freeUntil,
      driversEnforced: dto.driversEnforced ?? current.driversEnforced,
      driverTrialDays: dto.driverTrialDays ?? current.driverTrialDays,
      driverTrialStartedAt: current.driverTrialStartedAt,
    }, adminUserId);
  }
}
